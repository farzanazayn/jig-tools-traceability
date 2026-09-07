from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session, joinedload
from typing import Optional
from datetime import datetime
import traceback
from .. import models, schemas
from ..database import get_db, DB_SCHEMA

router = APIRouter(prefix="/api/request", tags=["borrow"])


def _request_to_out(b: models.BorrowRecord) -> schemas.RequestOut:
    return schemas.RequestOut(
        borrow_id=b.borrow_id,
        request_number=b.request_number,
        lot_id=b.lot_id,
        lot_number=b.lot.lot_number,
        jig_tool_name=b.lot.jig_tool.jig_tool_name,
        item_type=b.lot.jig_tool.item_type,
        department=b.lot.department,
        rack_location=b.lot.rack_location,
        technician_id=b.technician_id,
        technician_name=b.technician.technician_name,
        requested_qty=b.requested_qty,
        purpose=b.purpose,
        handler_no=b.handler_no,
        borrow_datetime=b.borrow_datetime,
        status=b.status,
    )


@router.get("", response_model=list[schemas.RequestOut])
def list_requests(status: Optional[str] = Query(None), db: Session = Depends(get_db)):
    # Eager-load lot/jig_tool/technician in one query instead of one extra query per
    # record per relationship — but skip the jig_tool's image bytes, which aren't
    # needed here and can be several MB each.
    q = db.query(models.BorrowRecord).options(
        joinedload(models.BorrowRecord.lot).joinedload(models.JigToolLot.jig_tool).load_only(
            models.JigTool.jig_tool_name, models.JigTool.item_type
        ),
        joinedload(models.BorrowRecord.technician),
    )
    if status:
        q = q.filter(models.BorrowRecord.status == status)
    records = q.order_by(models.BorrowRecord.borrow_datetime.desc()).all()
    return [_request_to_out(r) for r in records]


@router.post("", response_model=schemas.RequestOut)
def create_request(payload: schemas.RequestCreate, db: Session = Depends(get_db)):
    try:
        if not payload.handler_no or not payload.handler_no.strip():
            raise HTTPException(status_code=400, detail="Handler number is required.")

        lot = db.get(models.JigToolLot, payload.lot_id)
        if not lot:
            raise HTTPException(status_code=404, detail="Lot not found")

        technician = db.get(models.Technician, payload.technician_id)
        if not technician:
            raise HTTPException(status_code=404, detail="WBI not found. Please check your WBI or contact admin.")

        if lot.current_qty <= 0:
            raise HTTPException(status_code=400, detail=f"No units available for {lot.jig_tool.jig_tool_name}.")

        if payload.requested_qty > lot.current_qty:
            raise HTTPException(
                status_code=400,
                detail=f"Only {lot.current_qty} unit(s) available for {lot.jig_tool.jig_tool_name}."
            )

        next_val = db.execute(text(f'SELECT nextval(\'"{DB_SCHEMA}".jig_request_number_seq\')')).scalar()
        request_number = f"JT-{next_val:04d}"

        record = models.BorrowRecord(
            lot_id=payload.lot_id,
            technician_id=payload.technician_id,
            requested_qty=payload.requested_qty,
            purpose=payload.purpose,
            handler_no=payload.handler_no.strip(),
            status="pending",
            request_number=request_number,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return _request_to_out(record)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{borrow_id}/approve", response_model=schemas.RequestOut)
def approve_request(borrow_id: int, payload: schemas.AdminAction, db: Session = Depends(get_db)):
    try:
        record = db.get(models.BorrowRecord, borrow_id)
        if not record:
            raise HTTPException(status_code=404, detail="Request record not found")
        if record.status != "pending":
            raise HTTPException(status_code=400, detail=f"This request is already '{record.status}'.")

        admin = db.query(models.Admin).filter(models.Admin.username == payload.admin_username).first()
        if not admin:
            raise HTTPException(status_code=401, detail="Invalid admin session.")

        lot = record.lot
        if record.requested_qty > lot.current_qty:
            raise HTTPException(status_code=400, detail=f"Cannot approve — qty exceeds current stock ({lot.current_qty}).")

        lot.current_qty -= record.requested_qty
        record.status = "borrowed"
        record.borrow_datetime = datetime.utcnow()

        history = models.JigLotHistory(
            lot_id=lot.lot_id,
            action_type="OUT",
            qty_change=-record.requested_qty,
            qty_before=lot.current_qty + record.requested_qty,
            qty_after=lot.current_qty,
            reason=f"Request approved: {record.request_number}",
            technician_id=record.technician_id,
            admin_username=payload.admin_username,
            borrow_id=record.borrow_id,
            notes=f"Handler: {record.handler_no} | Purpose: {record.purpose}",
        )
        db.add(history)
        db.commit()
        db.refresh(record)
        return _request_to_out(record)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{borrow_id}/reject", response_model=schemas.RequestOut)
def reject_request(borrow_id: int, payload: schemas.AdminAction, db: Session = Depends(get_db)):
    try:
        record = db.get(models.BorrowRecord, borrow_id)
        if not record:
            raise HTTPException(status_code=404, detail="Request record not found")
        if record.status != "pending":
            raise HTTPException(status_code=400, detail=f"This request is already '{record.status}'.")

        admin = db.query(models.Admin).filter(models.Admin.username == payload.admin_username).first()
        if not admin:
            raise HTTPException(status_code=401, detail="Invalid admin session.")

        record.status = "rejected"
        db.commit()
        db.refresh(record)
        return _request_to_out(record)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{borrow_id}/return", response_model=schemas.ReturnOut)
def submit_return(borrow_id: int, payload: schemas.ReturnCreate, db: Session = Depends(get_db)):
    try:
        record = db.get(models.BorrowRecord, borrow_id)
        if not record:
            raise HTTPException(status_code=404, detail="Request record not found")
        if record.status != "borrowed":
            raise HTTPException(status_code=400, detail=f"Cannot return — status is '{record.status}'.")

        returning_tech = db.get(models.Technician, payload.returning_technician_id)
        if not returning_tech:
            raise HTTPException(status_code=404, detail="Returning WBI not found.")

        lot = record.lot
        qty_before = lot.current_qty
        lot.current_qty += record.requested_qty

        return_record = models.ReturnRecord(
            borrow_id=record.borrow_id,
            return_qty=record.requested_qty,
            returning_technician_id=payload.returning_technician_id,
        )
        db.add(return_record)
        record.status = "returned"

        history = models.JigLotHistory(
            lot_id=lot.lot_id,
            action_type="IN",
            qty_change=record.requested_qty,
            qty_before=qty_before,
            qty_after=lot.current_qty,
            reason=f"Return for {record.request_number}",
            technician_id=payload.returning_technician_id,
            borrow_id=record.borrow_id,
            notes=f"Returned {record.requested_qty} unit(s)",
        )
        db.add(history)
        db.commit()
        db.refresh(return_record)
        return return_record

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
