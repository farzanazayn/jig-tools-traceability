from sqlalchemy import Column, Integer, String, ForeignKey, TIMESTAMP, Boolean, Text, LargeBinary, func
from sqlalchemy.orm import relationship
from .database import Base


class Technician(Base):
    __tablename__ = "technicians"

    technician_id = Column(String(20), primary_key=True)
    technician_name = Column(String(100), nullable=False)
    department = Column(String(50))


class Admin(Base):
    __tablename__ = "admins"

    admin_id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    full_name = Column(String(100), nullable=False)
    password = Column(String(255), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())


class JigTool(Base):
    """Master catalog entry for a jig / tool (holds the picture)."""
    __tablename__ = "jig_tools"

    jig_tool_id = Column(Integer, primary_key=True, index=True)
    jig_tool_name = Column(String(150), nullable=False)
    item_type = Column(String(10), nullable=False, default="Jig")  # "Jig" or "Tool"
    department = Column(String(50), nullable=False)
    default_location = Column(String(50), nullable=False)
    default_qty = Column(Integer, nullable=False, default=0)
    image_data = Column(LargeBinary)
    image_mime = Column(String(50))
    created_at = Column(TIMESTAMP, server_default=func.now())

    lots = relationship("JigToolLot", back_populates="jig_tool")


class JigToolLot(Base):
    """A physical batch of a jig/tool at a specific rack location, with a qty in stock."""
    __tablename__ = "jig_tool_lots"

    lot_id = Column(Integer, primary_key=True, index=True)
    lot_number = Column(String(20), unique=True, nullable=False)
    jig_tool_id = Column(Integer, ForeignKey("jigtools.jig_tools.jig_tool_id"), nullable=False)
    department = Column(String(50), nullable=False)
    rack_location = Column(String(50), nullable=False)
    initial_qty = Column(Integer, nullable=False)
    current_qty = Column(Integer, nullable=False)
    replenish_limit = Column(Integer, nullable=False, default=5)
    total_damaged = Column(Integer, nullable=False, default=0)
    total_missing = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())

    jig_tool = relationship("JigTool", back_populates="lots")
    borrow_records = relationship("BorrowRecord", back_populates="lot")
    history = relationship("JigLotHistory", back_populates="lot")


class BorrowRecord(Base):
    __tablename__ = "borrow_records"

    borrow_id = Column(Integer, primary_key=True, index=True)
    request_number = Column(String(20), unique=True, nullable=False)
    lot_id = Column(Integer, ForeignKey("jigtools.jig_tool_lots.lot_id"), nullable=False)
    technician_id = Column(String(20), ForeignKey("jigtools.technicians.technician_id"), nullable=False)
    requested_qty = Column(Integer, nullable=False)
    purpose = Column(String(255), nullable=False)
    handler_no = Column(String(50), nullable=False)
    borrow_datetime = Column(TIMESTAMP, server_default=func.now())
    status = Column(String(20), nullable=False, default="pending")

    lot = relationship("JigToolLot", back_populates="borrow_records")
    technician = relationship("Technician")
    return_record = relationship("ReturnRecord", back_populates="borrow", uselist=False)


class ReturnRecord(Base):
    __tablename__ = "return_records"

    return_id = Column(Integer, primary_key=True, index=True)
    borrow_id = Column(Integer, ForeignKey("jigtools.borrow_records.borrow_id"), nullable=False)
    return_qty = Column(Integer, nullable=False)
    good_qty = Column(Integer, nullable=False, default=0)
    damaged_qty = Column(Integer, nullable=False, default=0)
    missing_qty = Column(Integer, nullable=False, default=0)
    returning_technician_id = Column(String(20), ForeignKey("jigtools.technicians.technician_id"))
    return_datetime = Column(TIMESTAMP, server_default=func.now())
    resolved = Column(Boolean, default=False)
    resolved_at = Column(TIMESTAMP)
    resolved_good_qty = Column(Integer, default=0)
    resolved_damaged_qty = Column(Integer, default=0)
    resolved_by = Column(String(50))

    borrow = relationship("BorrowRecord", back_populates="return_record")


class JigLotHistory(Base):
    __tablename__ = "jig_lot_history"

    history_id = Column(Integer, primary_key=True, index=True)
    lot_id = Column(Integer, ForeignKey("jigtools.jig_tool_lots.lot_id"), nullable=False)
    action_type = Column(String(50), nullable=False)
    qty_change = Column(Integer, default=0)
    qty_before = Column(Integer)
    qty_after = Column(Integer)
    location_before = Column(String(50))
    location_after = Column(String(50))
    reason = Column(String(255))
    technician_id = Column(String(20), ForeignKey("jigtools.technicians.technician_id"))
    admin_username = Column(String(50))
    borrow_id = Column(Integer, ForeignKey("jigtools.borrow_records.borrow_id"))
    notes = Column(Text)
    created_at = Column(TIMESTAMP, server_default=func.now())

    lot = relationship("JigToolLot", back_populates="history")
