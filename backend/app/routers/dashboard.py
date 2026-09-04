from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import traceback
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _format_duration(start: datetime) -> str:
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    delta = now - start
    total_minutes = int(delta.total_seconds() // 60)
    if total_minutes < 1:
        return "Just now"
    days, remainder = divmod(total_minutes, 60 * 24)
    hours, minutes = divmod(remainder, 60)
    parts = []
    if days: parts.append(f"{days}d")
    if hours: parts.append(f"{hours}h")
    if minutes or not parts: parts.append(f"{minutes}m")
    return " ".join(parts)


@router.get("/replenishment", response_model=list[schemas.ReplenishmentItem])
def replenishment_dashboard(db: Session = Depends(get_db)):
    lots = db.query(models.JigToolLot).order_by(models.JigToolLot.department, models.JigToolLot.lot_number).all()
    results = []
    for lot in lots:
        total_defect = lot.total_damaged + lot.total_missing
        status = "REPLENISH" if total_defect >= lot.replenish_limit else "OK"
        results.append(schemas.ReplenishmentItem(
            lot_id=lot.lot_id,
            lot_number=lot.lot_number,
            jig_tool_name=lot.jig_tool.jig_tool_name,
            item_type=lot.jig_tool.item_type,
            department=lot.department,
            rack_location=lot.rack_location,
            current_qty=lot.current_qty,
            total_damaged=lot.total_damaged,
            total_missing=lot.total_missing,
            total_defect=total_defect,
            replenish_limit=lot.replenish_limit,
            status=status,
        ))
    return results


@router.get("/requested", response_model=list[schemas.RequestedItem])
def requested_dashboard(db: Session = Depends(get_db)):
    records = (
        db.query(models.BorrowRecord)
        .filter(models.BorrowRecord.status == "borrowed")
        .order_by(models.BorrowRecord.borrow_datetime.asc())
        .all()
    )
    results = []
    for b in records:
        results.append(schemas.RequestedItem(
            borrow_id=b.borrow_id,
            request_number=b.request_number,
            lot_number=b.lot.lot_number,
            jig_tool_name=b.lot.jig_tool.jig_tool_name,
            rack_location=b.lot.rack_location,
            technician_id=b.technician_id,
            technician_name=b.technician.technician_name,
            requested_qty=b.requested_qty,
            purpose=b.purpose,
            handler_no=b.handler_no,
            borrow_datetime=b.borrow_datetime,
            duration=_format_duration(b.borrow_datetime),
        ))
    return results


@router.get("/missing", response_model=list[schemas.MissingUnitOut])
def missing_units(db: Session = Depends(get_db)):
    records = (
        db.query(models.ReturnRecord)
        .filter(models.ReturnRecord.missing_qty > 0, models.ReturnRecord.resolved == False)
        .order_by(models.ReturnRecord.return_datetime.desc())
        .all()
    )
    results = []
    for r in records:
        borrow = r.borrow
        lot = borrow.lot
        tech = db.get(models.Technician, borrow.technician_id)
        results.append(schemas.MissingUnitOut(
            return_id=r.return_id,
            borrow_id=r.borrow_id,
            lot_id=lot.lot_id,
            lot_number=lot.lot_number,
            jig_tool_name=lot.jig_tool.jig_tool_name,
            technician_name=tech.technician_name if tech else borrow.technician_id,
            missing_qty=r.missing_qty,
            return_datetime=r.return_datetime,
            duration=_format_duration(r.return_datetime),
            resolved=r.resolved,
        ))
    return results


@router.post("/missing/{return_id}/resolve")
def resolve_missing(return_id: int, payload: schemas.MissingUnitResolve, db: Session = Depends(get_db)):
    try:
        return_record = db.get(models.ReturnRecord, return_id)
        if not return_record:
            raise HTTPException(status_code=404, detail="Return record not found")
        if return_record.resolved:
            raise HTTPException(status_code=400, detail="Already resolved")

        admin = db.query(models.Admin).filter(models.Admin.username == payload.admin_username).first()
        if not admin:
            raise HTTPException(status_code=401, detail="Invalid admin session")

        total_resolved = payload.good_qty_recovered + payload.damaged_qty
        if total_resolved > return_record.missing_qty:
            raise HTTPException(status_code=400, detail=f"Resolved qty cannot exceed missing qty ({return_record.missing_qty})")

        borrow = return_record.borrow
        lot = borrow.lot
        qty_before = lot.current_qty

        lot.current_qty += payload.good_qty_recovered
        lot.total_damaged += payload.damaged_qty
        lot.total_missing -= return_record.missing_qty

        return_record.resolved = True
        return_record.resolved_at = datetime.utcnow()
        return_record.resolved_good_qty = payload.good_qty_recovered
        return_record.resolved_damaged_qty = payload.damaged_qty
        return_record.resolved_by = payload.admin_username

        history = models.JigLotHistory(
            lot_id=lot.lot_id,
            action_type="MISSING_RESOLVED",
            qty_before=qty_before,
            qty_after=lot.current_qty,
            qty_change=payload.good_qty_recovered,
            reason=f"Missing unit resolved for {borrow.request_number}",
            admin_username=payload.admin_username,
            borrow_id=borrow.borrow_id,
            notes=f"Good recovered: {payload.good_qty_recovered} | Damaged: {payload.damaged_qty}",
        )
        db.add(history)
        db.commit()
        return {"message": "Missing unit case resolved successfully."}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/lot-history")
def lot_history_search(
    search: str = Query(None),
    rack_location: str = Query(None),
    db: Session = Depends(get_db)
):
    q = db.query(models.JigToolLot)
    if search:
        q = q.join(models.JigTool).filter(models.JigTool.jig_tool_name.ilike(f"%{search}%"))
    if rack_location:
        q = q.filter(models.JigToolLot.rack_location.ilike(f"%{rack_location}%"))
    lots = q.order_by(models.JigToolLot.lot_number).all()
    return [{
        "lot_id": lot.lot_id,
        "lot_number": lot.lot_number,
        "jig_tool_name": lot.jig_tool.jig_tool_name,
        "department": lot.department,
        "rack_location": lot.rack_location,
        "current_qty": lot.current_qty,
        "total_damaged": lot.total_damaged,
        "total_missing": lot.total_missing,
    } for lot in lots]
