from fastapi import APIRouter, Depends, HTTPException, Form, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import Optional
import traceback
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/jigs", tags=["jigs"])

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def _to_out(j: models.JigTool) -> schemas.JigToolOut:
    return schemas.JigToolOut(
        jig_tool_id=j.jig_tool_id,
        jig_tool_name=j.jig_tool_name,
        item_type=j.item_type,
        department=j.department,
        default_location=j.default_location,
        default_qty=j.default_qty,
        has_image=bool(j.image_data),
    )


@router.get("", response_model=list[schemas.JigToolOut])
def list_jigs(db: Session = Depends(get_db)):
    items = db.query(models.JigTool).order_by(
        models.JigTool.department, models.JigTool.jig_tool_name
    ).all()
    return [_to_out(j) for j in items]


@router.post("", response_model=schemas.JigToolOut)
async def create_jig(
    jig_tool_name: str = Form(...),
    item_type: str = Form(...),
    department: str = Form(...),
    default_location: str = Form(...),
    default_qty: int = Form(0),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    try:
        image_data = None
        image_mime = None
        if image is not None and image.filename:
            if image.content_type not in ALLOWED_IMAGE_TYPES:
                raise HTTPException(status_code=400, detail="Image must be JPEG, PNG, WEBP or GIF.")
            data = await image.read()
            if len(data) > MAX_IMAGE_BYTES:
                raise HTTPException(status_code=400, detail="Image must be smaller than 5 MB.")
            image_data = data
            image_mime = image.content_type

        item = models.JigTool(
            jig_tool_name=jig_tool_name.strip(),
            item_type=item_type,
            department=department,
            default_location=default_location.strip(),
            default_qty=default_qty,
            image_data=image_data,
            image_mime=image_mime,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        return _to_out(item)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{jig_tool_id}/image")
def get_jig_image(jig_tool_id: int, db: Session = Depends(get_db)):
    item = db.get(models.JigTool, jig_tool_id)
    if not item or not item.image_data:
        raise HTTPException(status_code=404, detail="No image for this item")
    return Response(content=item.image_data, media_type=item.image_mime or "image/jpeg")


@router.delete("/{jig_tool_id}")
def delete_jig(jig_tool_id: int, admin_username: str, db: Session = Depends(get_db)):
    try:
        item = db.get(models.JigTool, jig_tool_id)
        if not item:
            raise HTTPException(status_code=404, detail="Jig/Tool not found")
        admin = db.query(models.Admin).filter(models.Admin.username == admin_username).first()
        if not admin:
            raise HTTPException(status_code=401, detail="Invalid admin session.")
        lots = db.query(models.JigToolLot).filter(models.JigToolLot.jig_tool_id == jig_tool_id).first()
        if lots:
            raise HTTPException(status_code=400, detail="Cannot delete an item with registered lots.")
        db.delete(item)
        db.commit()
        return {"message": f"'{item.jig_tool_name}' deleted."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
