from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .database import Base, engine, init_schema
from .routers import technicians, jigs, jig_lots, borrow, auth

init_schema()
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Jig & Tools Maintenance Traceability System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(technicians.router)
app.include_router(jigs.router)
app.include_router(jig_lots.router)
app.include_router(borrow.router)

frontend_path = Path("frontend")
if frontend_path.is_dir():
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
