from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


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
    } for lot in lots]
