from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import re
import traceback
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/lots", tags=["jig-lots"])


def _generate_lot_number(db: Session, jig_tool_name: str) -> str:
    """Lot numbers are an internal bookkeeping detail, not shown in the UI —
    derive one from the jig/tool name and disambiguate on collision."""
    base = re.sub(r"[^A-Z0-9]+", "-", jig_tool_name.upper()).strip("-")[:40] or "LOT"
    candidate = base
    suffix = 1
    while db.query(models.JigToolLot).filter(models.JigToolLot.lot_number == candidate).first():
        suffix += 1
        candidate = f"{base}-{suffix}"
    return candidate


def _lot_to_out(lot: models.JigToolLot) -> schemas.LotOut:
    return schemas.LotOut(
        lot_id=lot.lot_id,
        lot_number=lot.lot_number,
        jig_tool_id=lot.jig_tool_id,
        jig_tool_name=lot.jig_tool.jig_tool_name,
        item_type=lot.jig_tool.item_type,
        department=lot.department,
        process=lot.jig_tool.process,
        machine=lot.jig_tool.machine,
        rack_location=lot.rack_location,
        initial_qty=lot.initial_qty,
        current_qty=lot.current_qty,
        has_image=bool(lot.jig_tool.image_data),
    )


@router.get("", response_model=list[schemas.LotOut])
def list_lots(db: Session = Depends(get_db)):
    # Select has_image as "image_data IS NOT NULL" computed in Postgres, instead of
    # loading every jig/tool's full picture (can be several MB each) just to check
    # whether one exists — this is what made the list slow to load.
    rows = (
        db.query(
            models.JigToolLot,
            models.JigTool.jig_tool_name,
            models.JigTool.item_type,
            models.JigTool.process,
            models.JigTool.machine,
            models.JigTool.image_data.isnot(None).label("has_image"),
        )
        .join(models.JigTool, models.JigToolLot.jig_tool_id == models.JigTool.jig_tool_id)
        .order_by(models.JigToolLot.lot_id)
        .all()
    )
    return [
        schemas.LotOut(
            lot_id=lot.lot_id,
            lot_number=lot.lot_number,
            jig_tool_id=lot.jig_tool_id,
            jig_tool_name=jig_tool_name,
            item_type=item_type,
            department=lot.department,
            process=process,
            machine=machine,
            rack_location=lot.rack_location,
            initial_qty=lot.initial_qty,
            current_qty=lot.current_qty,
            has_image=has_image,
        )
        for lot, jig_tool_name, item_type, process, machine, has_image in rows
    ]


@router.post("", response_model=schemas.LotOut)
def register_lot(payload: schemas.LotCreate, db: Session = Depends(get_db)):
    try:
        jig_tool = db.get(models.JigTool, payload.jig_tool_id)
        if not jig_tool:
            raise HTTPException(status_code=404, detail="Jig/Tool not found")

        lot_number = _generate_lot_number(db, jig_tool.jig_tool_name)

        lot = models.JigToolLot(
            lot_number=lot_number,
            jig_tool_id=jig_tool.jig_tool_id,
            department=jig_tool.department,
            rack_location=payload.rack_location,
            initial_qty=payload.initial_qty,
            current_qty=payload.initial_qty,
        )
        db.add(lot)
        db.commit()
        db.refresh(lot)

        history = models.JigLotHistory(
            lot_id=lot.lot_id,
            action_type="REGISTERED",
            qty_before=0,
            qty_after=payload.initial_qty,
            qty_change=payload.initial_qty,
            reason="Initial registration",
            notes=f"Registered with {payload.initial_qty} unit(s) at {payload.rack_location}",
        )
        db.add(history)
        db.commit()
        return _lot_to_out(lot)

    except HTTPException:
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Lot number already exists.")
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{lot_id}", response_model=schemas.LotOut)
def update_lot(lot_id: int, payload: schemas.LotUpdate, db: Session = Depends(get_db)):
    try:
        lot = db.get(models.JigToolLot, lot_id)
        if not lot:
            raise HTTPException(status_code=404, detail="Lot not found")

        admin = db.query(models.Admin).filter(models.Admin.username == payload.admin_username).first()
        if not admin:
            raise HTTPException(status_code=401, detail="Invalid admin session.")

        qty_before = lot.current_qty
        loc_before = lot.rack_location

        if payload.new_qty is not None:
            lot.current_qty = payload.new_qty
            lot.initial_qty = payload.new_qty

        if payload.rack_location is not None:
            lot.rack_location = payload.rack_location

        action = "QTY_UPDATE" if payload.new_qty is not None else "LOCATION_CHANGE"
        notes_parts_str = f"Updated by {admin.full_name}"

        history = models.JigLotHistory(
            lot_id=lot.lot_id,
            action_type=action,
            qty_before=qty_before,
            qty_after=lot.current_qty,
            qty_change=(lot.current_qty - qty_before),
            location_before=loc_before,
            location_after=lot.rack_location,
            reason=payload.reason,
            admin_username=payload.admin_username,
            notes=notes_parts_str,
        )
        db.add(history)
        db.commit()
        db.refresh(lot)
        return _lot_to_out(lot)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{lot_id}")
def delete_lot(lot_id: int, admin_username: str, db: Session = Depends(get_db)):
    try:
        lot = db.get(models.JigToolLot, lot_id)
        if not lot:
            raise HTTPException(status_code=404, detail="Lot not found")

        admin = db.query(models.Admin).filter(models.Admin.username == admin_username).first()
        if not admin:
            raise HTTPException(status_code=401, detail="Invalid admin session.")

        active = db.query(models.BorrowRecord).filter(
            models.BorrowRecord.lot_id == lot_id,
            models.BorrowRecord.status.in_(["pending", "borrowed"])
        ).first()

        if active:
            raise HTTPException(status_code=400, detail="Cannot delete lot with active or pending requests.")

        name = lot.jig_tool.jig_tool_name
        db.delete(lot)
        db.commit()
        return {"message": f"'{name}' deleted."}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{lot_id}/history", response_model=list[schemas.LotHistoryOut])
def get_lot_history(lot_id: int, db: Session = Depends(get_db)):
    try:
        lot = db.get(models.JigToolLot, lot_id)
        if not lot:
            raise HTTPException(status_code=404, detail="Lot not found")

        history = db.query(models.JigLotHistory).filter(
            models.JigLotHistory.lot_id == lot_id
        ).order_by(models.JigLotHistory.created_at.desc()).all()

        technician_ids = {h.technician_id for h in history if h.technician_id}
        tech_names = {}
        if technician_ids:
            tech_names = dict(
                db.query(models.Technician.technician_id, models.Technician.technician_name)
                .filter(models.Technician.technician_id.in_(technician_ids))
                .all()
            )

        result = []
        for h in history:
            tech_name = tech_names.get(h.technician_id, h.technician_id) if h.technician_id else None

            result.append(schemas.LotHistoryOut(
                history_id=h.history_id,
                lot_id=h.lot_id,
                lot_number=lot.lot_number,
                jig_tool_name=lot.jig_tool.jig_tool_name,
                action_type=h.action_type,
                qty_change=h.qty_change or 0,
                qty_before=h.qty_before,
                qty_after=h.qty_after,
                location_before=h.location_before,
                location_after=h.location_after,
                reason=h.reason,
                technician_name=tech_name,
                admin_username=h.admin_username,
                notes=h.notes,
                created_at=h.created_at,
            ))
        return result

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
