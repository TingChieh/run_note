from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.dependencies import get_read_identity, get_session, require_auth_config, require_write
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.wellbeing import medications as meds
from app.modules.wellbeing import report, service
from app.modules.wellbeing.schema import (
    BatchDoseInput,
    BatchDoseResult,
    CountInput,
    DaySummary,
    DayView,
    Deleted,
    DoseInput,
    DosePatch,
    DoseView,
    EntryInput,
    EntryList,
    EntryView,
    MedicationInput,
    MedicationPatch,
    MedicationView,
    RestockInput,
    SymptomInput,
    SymptomNameInput,
    SymptomNameView,
    SymptomPatch,
    SymptomView,
    Trends,
)

# Private by construction: every route needs the signed-in owner, and nothing here is exposed to
# the showcase, sharing or AI modules.
router = APIRouter(
    prefix="/api/v1/me/wellbeing",
    tags=["wellbeing"],
    dependencies=[Depends(require_auth_config)],
)

Read = Annotated[tuple, Depends(get_read_identity)]
Write = Annotated[tuple, Depends(require_write)]
DB = Annotated[Session, Depends(get_session)]
Start = Annotated[date, Query(alias="from")]
End = Annotated[date, Query(alias="to")]


@router.get("/days", response_model=ApiResponse[list[DaySummary]])
def calendar(request: Request, identity: Read, db: DB, start: Start, end: End):
    data = service.day_marks(db, identity[1].id, start, end)
    db.commit()
    return envelope(request, data)


@router.get("/days/{day}", response_model=ApiResponse[DayView])
def read_day(day: date, request: Request, identity: Read, db: DB):
    data = service.read_day(db, identity[1], day, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.put("/days/{day}/entry", response_model=ApiResponse[EntryView])
def save_entry(day: date, payload: EntryInput, request: Request, identity: Write, db: DB):
    data = service.save_entry(db, identity[1], day, payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.delete("/days/{day}/entry", response_model=ApiResponse[Deleted])
def delete_entry(day: date, request: Request, identity: Write, db: DB):
    service.delete_entry(db, identity[1].id, day)
    db.commit()
    return envelope(request, Deleted())


@router.get("/entries", response_model=ApiResponse[EntryList])
def entries(
    request: Request,
    identity: Read,
    db: DB,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
):
    data = service.list_entries(db, identity[1].id, start, end, limit, offset)
    db.commit()
    return envelope(request, data)


@router.get("/medications", response_model=ApiResponse[list[MedicationView]])
def medications(request: Request, identity: Read, db: DB):
    data = meds.medication_views(db, identity[1].id, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.post("/medications", response_model=ApiResponse[MedicationView], status_code=201)
def create_medication(payload: MedicationInput, request: Request, identity: Write, db: DB):
    data = meds.create_medication(db, identity[1].id, payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.patch("/medications/{identifier}", response_model=ApiResponse[MedicationView])
def update_medication(
    identifier: UUID, payload: MedicationPatch, request: Request, identity: Write, db: DB
):
    data = meds.update_medication(
        db, identity[1].id, identifier, payload, request.app.state.clock()
    )
    db.commit()
    return envelope(request, data)


@router.delete("/medications/{identifier}", response_model=ApiResponse[Deleted])
def delete_medication(identifier: UUID, request: Request, identity: Write, db: DB):
    meds.delete_medication(db, identity[1].id, identifier)
    db.commit()
    return envelope(request, Deleted())


@router.post("/medications/{identifier}/stock", response_model=ApiResponse[MedicationView])
def restock(identifier: UUID, payload: RestockInput, request: Request, identity: Write, db: DB):
    data = meds.restock(db, identity[1].id, identifier, payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.post("/medications/{identifier}/stock/count", response_model=ApiResponse[MedicationView])
def count_stock(identifier: UUID, payload: CountInput, request: Request, identity: Write, db: DB):
    data = meds.count_stock(db, identity[1].id, identifier, payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.get("/symptom-names", response_model=ApiResponse[list[SymptomNameView]])
def symptom_names(request: Request, identity: Read, db: DB):
    data = service.symptom_name_views(db, identity[1].id)
    db.commit()
    return envelope(request, data)


@router.post("/symptom-names", response_model=ApiResponse[SymptomNameView], status_code=201)
def create_symptom_name(payload: SymptomNameInput, request: Request, identity: Write, db: DB):
    data = service.create_symptom_name(db, identity[1].id, payload)
    db.commit()
    return envelope(request, data)


@router.delete("/symptom-names/{identifier}", response_model=ApiResponse[Deleted])
def delete_symptom_name(identifier: UUID, request: Request, identity: Write, db: DB):
    service.delete_symptom_name(db, identity[1].id, identifier)
    db.commit()
    return envelope(request, Deleted())


@router.post("/doses/batch", response_model=ApiResponse[BatchDoseResult], status_code=201)
def batch_doses(payload: BatchDoseInput, request: Request, identity: Write, db: DB):
    data = meds.batch_doses(db, identity[1], payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.post("/doses", response_model=ApiResponse[DoseView], status_code=201)
def create_dose(payload: DoseInput, request: Request, identity: Write, db: DB):
    data = meds.create_dose(db, identity[1], payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.patch("/doses/{identifier}", response_model=ApiResponse[DoseView])
def update_dose(identifier: UUID, payload: DosePatch, request: Request, identity: Write, db: DB):
    data = meds.update_dose(db, identity[1], identifier, payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.delete("/doses/{identifier}", response_model=ApiResponse[Deleted])
def delete_dose(identifier: UUID, request: Request, identity: Write, db: DB):
    meds.delete_dose(db, identity[1].id, identifier)
    db.commit()
    return envelope(request, Deleted())


@router.post("/symptoms", response_model=ApiResponse[SymptomView], status_code=201)
def create_symptom(payload: SymptomInput, request: Request, identity: Write, db: DB):
    data = service.create_symptom(db, identity[1], payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.patch("/symptoms/{identifier}", response_model=ApiResponse[SymptomView])
def update_symptom(
    identifier: UUID, payload: SymptomPatch, request: Request, identity: Write, db: DB
):
    data = service.update_symptom(db, identity[1], identifier, payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.delete("/symptoms/{identifier}", response_model=ApiResponse[Deleted])
def delete_symptom(identifier: UUID, request: Request, identity: Write, db: DB):
    service.delete_symptom(db, identity[1].id, identifier)
    db.commit()
    return envelope(request, Deleted())


@router.get("/trends", response_model=ApiResponse[Trends])
def trends(
    request: Request,
    identity: Read,
    db: DB,
    days: Annotated[str, Query(pattern=r"^(7|14|30)$")] = "7",
):
    data = service.trends(db, identity[1], int(days), request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.get("/report", response_model=ApiResponse[report.Report])
def clinic_report(request: Request, identity: Read, db: DB, start: Start, end: End):
    data = report.build_report(db, identity[1], start, end, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.get("/report.csv")
def report_csv(
    request: Request,
    identity: Read,
    db: DB,
    start: Start,
    end: End,
    kind: Annotated[report.CsvKind, Query()] = "entries",
):
    rows = report.csv_rows(db, identity[1], kind, start, end)
    db.commit()
    return Response(
        report.render_csv(rows),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="wellbeing-{kind}-{start}_{end}.csv"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
