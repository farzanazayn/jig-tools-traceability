from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class TechnicianOut(BaseModel):
    technician_id: str
    technician_name: str
    department: Optional[str] = None
    class Config:
        from_attributes = True

class TechnicianCreate(BaseModel):
    technician_id: str
    technician_name: str
    department: str


class JigToolOut(BaseModel):
    jig_tool_id: int
    jig_tool_name: str
    item_type: str
    department: str
    process: Optional[str] = None
    machine: Optional[str] = None
    default_location: str
    default_qty: int
    has_image: bool = False
    class Config:
        from_attributes = True


class LotCreate(BaseModel):
    lot_number: str
    jig_tool_id: int
    rack_location: str
    initial_qty: int = Field(gt=0)

class LotOut(BaseModel):
    lot_id: int
    lot_number: str
    jig_tool_id: int
    jig_tool_name: str
    item_type: str
    department: str
    rack_location: str
    initial_qty: int
    current_qty: int
    has_image: bool = False
    class Config:
        from_attributes = True

class LotUpdate(BaseModel):
    lot_number: Optional[str] = None
    new_qty: Optional[int] = None
    rack_location: Optional[str] = None
    reason: str
    admin_username: str


class RequestCreate(BaseModel):
    lot_id: int
    technician_id: str
    purpose: str
    requested_qty: int = Field(gt=0)
    handler_no: str

class RequestOut(BaseModel):
    borrow_id: int
    request_number: str
    lot_id: int
    lot_number: str
    jig_tool_name: str
    item_type: str
    department: str
    rack_location: str
    technician_id: str
    technician_name: str
    requested_qty: int
    purpose: str
    handler_no: str
    borrow_datetime: datetime
    status: str
    class Config:
        from_attributes = True


class ReturnCreate(BaseModel):
    returning_technician_id: str

class ReturnOut(BaseModel):
    return_id: int
    borrow_id: int
    return_qty: int
    returning_technician_id: str
    return_datetime: datetime
    class Config:
        from_attributes = True


class LotHistoryOut(BaseModel):
    history_id: int
    lot_id: int
    lot_number: str
    jig_tool_name: str
    action_type: str
    qty_change: int = 0
    qty_before: Optional[int] = None
    qty_after: Optional[int] = None
    location_before: Optional[str] = None
    location_after: Optional[str] = None
    reason: Optional[str] = None
    technician_name: Optional[str] = None
    admin_username: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True


class AdminLogin(BaseModel):
    username: str
    password: str

class AdminOut(BaseModel):
    admin_id: int
    username: str
    full_name: str
    class Config:
        from_attributes = True

class AdminAction(BaseModel):
    admin_username: str
