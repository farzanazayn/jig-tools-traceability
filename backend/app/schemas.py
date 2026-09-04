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
    replenish_limit: int = Field(default=5, gt=0)

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
    replenish_limit: int
    total_damaged: int = 0
    total_missing: int = 0
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
    good_qty: int = Field(ge=0, default=0)
    damaged_qty: int = Field(ge=0, default=0)
    missing_qty: int = Field(ge=0, default=0)
    returning_technician_id: str

class ReturnOut(BaseModel):
    return_id: int
    borrow_id: int
    return_qty: int
    good_qty: int
    damaged_qty: int
    missing_qty: int
    returning_technician_id: str
    return_datetime: datetime
    class Config:
        from_attributes = True


class MissingUnitOut(BaseModel):
    return_id: int
    borrow_id: int
    lot_id: int
    lot_number: str
    jig_tool_name: str
    technician_name: str
    missing_qty: int
    return_datetime: datetime
    duration: str
    resolved: bool = False
    class Config:
        from_attributes = True

class MissingUnitResolve(BaseModel):
    good_qty_recovered: int = Field(ge=0, default=0)
    damaged_qty: int = Field(ge=0, default=0)
    admin_username: str


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


class ReplenishmentItem(BaseModel):
    lot_id: int
    lot_number: str
    jig_tool_name: str
    item_type: str
    department: str
    rack_location: str
    current_qty: int
    total_damaged: int
    total_missing: int
    total_defect: int
    replenish_limit: int
    status: str

class RequestedItem(BaseModel):
    borrow_id: int
    request_number: str
    lot_number: str
    jig_tool_name: str
    rack_location: str
    technician_id: str
    technician_name: str
    requested_qty: int
    purpose: str
    handler_no: str
    borrow_datetime: datetime
    duration: str


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
