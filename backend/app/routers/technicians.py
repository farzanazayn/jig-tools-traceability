from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import Optional
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/technicians", tags=["technicians"])


@router.get("", response_model=list[schemas.TechnicianOut])
def list_technicians(department: Optional[str] = Query(None), db: Session = Depends(get_db)):
    q = db.query(models.Technician)
    if department:
        q = q.filter(models.Technician.department.ilike(f"%{department}%"))
    return q.order_by(models.Technician.technician_name).all()


@router.get("/{technician_id}", response_model=schemas.TechnicianOut)
def get_technician(technician_id: str, db: Session = Depends(get_db)):
    tech = db.get(models.Technician, technician_id)
    if not tech:
        raise HTTPException(status_code=404, detail="WBI not found")
    return tech


@router.post("", response_model=schemas.TechnicianOut)
def create_technician(payload: schemas.TechnicianCreate, db: Session = Depends(get_db)):
    tech = models.Technician(**payload.model_dump())
    db.add(tech)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="WBI already exists")
    db.refresh(tech)
    return tech
