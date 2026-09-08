from fastapi import APIRouter, Depends, HTTPException, Form, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import Optional
import io
import re
import csv
import zipfile
import mimetypes
import traceback
import openpyxl
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/jigs", tags=["jigs"])

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _to_out(j: models.JigTool) -> schemas.JigToolOut:
    return schemas.JigToolOut(
        jig_tool_id=j.jig_tool_id,
        jig_tool_name=j.jig_tool_name,
        item_type=j.item_type,
        department=j.department,
        process=j.process,
        machine=j.machine,
        default_location=j.default_location,
        default_qty=j.default_qty,
        has_image=bool(j.image_data),
    )


@router.get("", response_model=list[schemas.JigToolOut])
def list_jigs(db: Session = Depends(get_db)):
    # Compute has_image as "image_data IS NOT NULL" in Postgres rather than loading
    # every picture (can be several MB each) just to check whether one exists.
    rows = (
        db.query(
            models.JigTool.jig_tool_id,
            models.JigTool.jig_tool_name,
            models.JigTool.item_type,
            models.JigTool.department,
            models.JigTool.process,
            models.JigTool.machine,
            models.JigTool.default_location,
            models.JigTool.default_qty,
            models.JigTool.image_data.isnot(None).label("has_image"),
        )
        .order_by(models.JigTool.department, models.JigTool.jig_tool_name)
        .all()
    )
    return [schemas.JigToolOut(**row._mapping) for row in rows]


@router.post("", response_model=schemas.JigToolOut)
async def create_jig(
    jig_tool_name: str = Form(...),
    item_type: str = Form(...),
    department: str = Form(...),
    process: Optional[str] = Form(None),
    machine: Optional[str] = Form(None),
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
            process=process,
            machine=machine,
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


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _parse_qty(raw) -> Optional[int]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return int(raw)
    match = re.search(r"\d+", str(raw))
    return int(match.group()) if match else None


_HEADER_ALIASES = {
    "description": "description",
    "binlocation": "rack_location",
    "location": "rack_location",
    "rack": "rack_location",
    "rackblocation": "rack_location",
    "stockinhand": "qty",
    "qty": "qty",
    "quantity": "qty",
    "stockqty": "qty",
    "qtyinhand": "qty",
    "availableqty": "qty",
    "parttype": "item_type",
    "type": "item_type",
    "process": "process",
    "machine": "machine",
    "oempartnumber": "code",
    "partnumber": "code",
    "department": "department",
    "dept": "department",
}


_IMAGE_FORMAT_MIME = {
    "png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg",
    "gif": "image/gif", "bmp": "image/bmp",
}


def _extract_embedded_images(ws) -> dict:
    """Maps 0-indexed sheet row -> (bytes, mime) for images that are floating/anchored
    over a cell (the classic Insert > Pictures method) via openpyxl's drawing API.
    If a row has more than one image anchored, the first one wins."""
    result = {}
    for img in getattr(ws, "_images", []):
        try:
            row = img.anchor._from.row
            if row in result:
                continue
            data = img._data()
            if len(data) > MAX_IMAGE_BYTES:
                continue
            mime = _IMAGE_FORMAT_MIME.get((img.format or "").lower(), "image/png")
            result[row] = (data, mime)
        except Exception:
            continue
    return result


def _extract_media_files_from_zip(data: bytes) -> list:
    """Fallback for Excel's newer 'Place in Cell' picture type (Insert > Pictures >
    Place in Cell), which is stored as a rich-value cell reference rather than a
    floating/anchored drawing — openpyxl's image API (_extract_embedded_images
    above) cannot see these at all. An xlsx is just a zip file, so this pulls every
    image straight out of its media folder, in Excel's own internal numeric order
    (image1.png, image2.png, ...), without needing to understand the rich-value
    XML linkage. Whether that order can be trusted to match row order is decided
    by the caller."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            media_names = [n for n in z.namelist() if n.startswith("xl/media/")]

            def _sort_key(name):
                m = re.search(r"(\d+)", name.rsplit("/", 1)[-1])
                return int(m.group(1)) if m else 0

            media_names.sort(key=_sort_key)
            out = []
            for name in media_names:
                try:
                    raw = z.read(name)
                    if len(raw) > MAX_IMAGE_BYTES:
                        continue
                    ext = name.rsplit(".", 1)[-1].lower()
                    mime = _IMAGE_FORMAT_MIME.get(ext) or mimetypes.guess_type(name)[0] or "image/png"
                    out.append((raw, mime))
                except Exception:
                    continue
            return out
    except Exception:
        return []


def _read_rows(filename: str, data: bytes):
    """Returns (records, embedded_images) — records is a list of normalized-field dicts,
    embedded_images maps the record's list index -> (bytes, mime) for any picture embedded
    directly in that row of the spreadsheet (xlsx only)."""
    lower = filename.lower()
    embedded_by_row = {}
    if lower.endswith(".csv"):
        text = data.decode("utf-8-sig")
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
    elif lower.endswith(".xlsx") or lower.endswith(".xlsm"):
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        ws = wb.worksheets[0]
        # Read cell-by-cell rather than via values_only=True in one shot: a cell
        # using Excel's newer "Place in Cell" picture type isn't a normal value,
        # and openpyxl can throw trying to resolve it — one bad cell shouldn't
        # sink the whole import, so treat it as blank instead.
        rows = []
        for sheet_row in ws.iter_rows():
            row_values = []
            for cell in sheet_row:
                try:
                    row_values.append(cell.value)
                except Exception:
                    row_values.append(None)
            rows.append(row_values)
        try:
            embedded_by_row = _extract_embedded_images(ws)
        except Exception:
            embedded_by_row = {}

        if not embedded_by_row:
            # No floating/anchored pictures found — this sheet may be using Excel's
            # newer "Place in Cell" picture type instead, which openpyxl can't read
            # via the drawing API at all. Fall back to pulling images straight out
            # of the xlsx's media folder. This only tells us the images exist and
            # their internal order, not which row each belongs to — so only trust
            # a positional (top-to-bottom) match when the count lines up exactly
            # with the number of data rows. Otherwise, guessing risks attaching the
            # wrong picture to the wrong item, which is worse than attaching none.
            media = _extract_media_files_from_zip(data)
            data_row_count = max(len(rows) - 1, 0)
            if media and len(media) == data_row_count:
                embedded_by_row = {i + 1: media[i] for i in range(len(media))}
    else:
        raise HTTPException(status_code=400, detail="Spreadsheet must be .xlsx or .csv")

    if not rows:
        return [], {}

    header_row = rows[0]
    field_by_col = {}
    for idx, header in enumerate(header_row):
        key = _normalize(str(header)) if header else ""
        if key in _HEADER_ALIASES:
            field_by_col[idx] = _HEADER_ALIASES[key]

    if "description" not in field_by_col.values():
        raise HTTPException(status_code=400, detail="Could not find a 'Description' column in the spreadsheet.")

    # No quantity column at all (e.g. a sheet that's just Description + Picture) is
    # a structural difference, not a per-row data problem — default every row to 1
    # instead of flagging all of them as errors. A sheet that DOES have a quantity
    # column but leaves a specific cell blank/invalid still gets flagged per-row,
    # since that's actually missing data worth fixing at the source.
    has_qty_column = "qty" in field_by_col.values()

    records = []
    embedded_by_record_idx = {}
    for row_idx, row in enumerate(rows[1:], start=1):
        record = {}
        for idx, field in field_by_col.items():
            record[field] = row[idx] if idx < len(row) else None
        if not has_qty_column:
            record["qty"] = 1
        if record.get("description"):
            if row_idx in embedded_by_row:
                embedded_by_record_idx[len(records)] = embedded_by_row[row_idx]
            records.append(record)

    return records, embedded_by_record_idx


@router.post("/bulk-import")
async def bulk_import_jigs(
    department: str = Form(...),
    admin_username: str = Form(...),
    file: UploadFile = File(...),
    images: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    admin = db.query(models.Admin).filter(models.Admin.username == admin_username).first()
    if not admin:
        raise HTTPException(status_code=401, detail="Invalid admin session.")

    sheet_bytes = await file.read()
    try:
        records, embedded_images = _read_rows(file.filename, sheet_bytes)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read spreadsheet: {e}")

    # Preload uploaded pictures, keyed by normalized filename stem
    image_by_key = {}
    for img in images:
        if not img.filename:
            continue
        ext = "." + img.filename.rsplit(".", 1)[-1].lower() if "." in img.filename else ""
        if ext not in ALLOWED_IMAGE_EXTS:
            continue
        stem = img.filename.rsplit(".", 1)[0]
        data = await img.read()
        if len(data) > MAX_IMAGE_BYTES:
            continue
        mime = mimetypes.guess_type(img.filename)[0] or "image/jpeg"
        image_by_key[_normalize(stem)] = (data, mime)

    created = []
    skipped = []
    errors = []
    pictures_matched = 0

    # Preload everything the loop needs to check, in bulk, instead of running 2+
    # queries per spreadsheet row (which meant ~200+ network round trips to a
    # remote DB for a ~100-row sheet). The loop below only touches these in-memory
    # structures; nothing hits the DB until the single commit at the end.
    row_departments = {
        str(r.get("department") or "").strip() or department for r in records
    }
    # Keyed case-insensitively: a prior manual UPPERCASE-normalization pass (or
    # just inconsistent typing) means the sheet's name and the DB's stored name
    # won't always match by exact case — an exact-match lookup here would treat
    # "Charge Plate" and "CHARGE PLATE" as two different items and either miss
    # the backfill or create a duplicate.
    existing_jigs = {
        (j.jig_tool_name.strip().upper(), j.department): j
        for j in db.query(models.JigTool).filter(models.JigTool.department.in_(row_departments)).all()
    }
    existing_lot_numbers = {ln for (ln,) in db.query(models.JigToolLot.lot_number).all()}
    existing_lots_by_jig_tool_id = {
        l.jig_tool_id: l
        for l in db.query(models.JigToolLot).filter(
            models.JigToolLot.jig_tool_id.in_([j.jig_tool_id for j in existing_jigs.values()])
        ).all()
    }

    for record_idx, record in enumerate(records):
        name = str(record.get("description") or "").strip()
        if not name:
            continue

        qty = _parse_qty(record.get("qty"))
        if qty is None:
            errors.append(f"{name}: could not read a quantity from '{record.get('qty')}'")
            continue

        item_type = str(record.get("item_type") or "Jig").strip()
        if item_type not in ("Jig", "Tool"):
            item_type = "Jig"

        row_department = str(record.get("department") or "").strip() or department
        process = (str(record.get("process")).strip() if record.get("process") else None) or None
        machine = (str(record.get("machine")).strip() if record.get("machine") else None) or None
        rack_location = str(record.get("rack_location") or "").strip()
        code = str(record.get("code") or "").strip()

        image_data = image_mime = None
        match = image_by_key.get(_normalize(name)) or embedded_images.get(record_idx)
        if match:
            image_data, image_mime = match

        existing_jig = existing_jigs.get((name.strip().upper(), row_department))
        if existing_jig:
            # Backfill only fields that are currently blank — never overwrite
            # something an admin may have already set or corrected by hand, and
            # never touch qty (that reflects live stock, not description data).
            updated = []
            if match and not existing_jig.image_data:
                existing_jig.image_data = image_data
                existing_jig.image_mime = image_mime
                pictures_matched += 1
                updated.append("picture")
            if machine and not existing_jig.machine:
                existing_jig.machine = machine
                updated.append("machine")
            if process and not existing_jig.process:
                existing_jig.process = process
                updated.append("process")
            existing_lot = existing_lots_by_jig_tool_id.get(existing_jig.jig_tool_id)
            if existing_lot and rack_location and not existing_lot.rack_location:
                existing_lot.rack_location = rack_location
                updated.append("location")
            if updated:
                skipped.append(f"{name}: already existed — updated {', '.join(updated)}")
            else:
                skipped.append(f"{name}: a jig/tool with this name already exists in {row_department}")
            continue

        lot_number = code if code else _normalize(name)[:45].upper() or f"IMPORT-{len(created)+1}"
        if lot_number in existing_lot_numbers:
            skipped.append(f"{name}: lot number '{lot_number}' already exists")
            continue

        if match:
            pictures_matched += 1

        # Each row gets its own SAVEPOINT: if something fails mid-row (a flush
        # error, say), only this row's changes roll back — everything already
        # processed earlier in the batch is untouched and still gets committed
        # for real in the single db.commit() after the loop.
        try:
            with db.begin_nested():
                jig_tool = models.JigTool(
                    jig_tool_name=name,
                    item_type=item_type,
                    department=row_department,
                    process=process,
                    machine=machine,
                    default_location=rack_location,
                    default_qty=qty,
                    image_data=image_data,
                    image_mime=image_mime,
                )
                db.add(jig_tool)
                db.flush()

                lot = models.JigToolLot(
                    lot_number=lot_number,
                    jig_tool_id=jig_tool.jig_tool_id,
                    department=row_department,
                    rack_location=rack_location,
                    initial_qty=qty,
                    current_qty=qty,
                )
                db.add(lot)
                db.flush()

                history = models.JigLotHistory(
                    lot_id=lot.lot_id,
                    action_type="REGISTERED",
                    qty_before=0,
                    qty_after=qty,
                    qty_change=qty,
                    reason="Bulk import",
                    admin_username=admin_username,
                    notes=f"Imported from {file.filename}",
                )
                db.add(history)

            existing_jigs[(name.strip().upper(), row_department)] = jig_tool
            existing_lot_numbers.add(lot_number)
            created.append(name)

        except Exception as e:
            errors.append(f"{name}: {e}")

    db.commit()

    return {
        "created_count": len(created),
        "skipped_count": len(skipped),
        "error_count": len(errors),
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "pictures_matched": pictures_matched,
        "pictures_uploaded": len(image_by_key),
        "pictures_embedded_in_sheet": len(embedded_images),
    }


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
