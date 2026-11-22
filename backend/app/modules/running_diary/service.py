from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.activities.service import lock_owner, owned_activity
from app.modules.running_diary.model import ActivityDiary, ActivityDiaryPhoto
from app.modules.running_diary.schema import DiaryDetail, DiaryInput, DiaryPhotoView, DiaryView
from app.modules.site_settings.images import ProcessedImage

MAX_PHOTOS = 6


def _find_diary(db: Session, owner: UUID, activity_id: UUID) -> ActivityDiary | None:
    return db.scalar(
        select(ActivityDiary).where(
            ActivityDiary.activity_id == activity_id, ActivityDiary.user_id == owner
        )
    )


def _photo_view(photo: ActivityDiaryPhoto) -> DiaryPhotoView:
    return DiaryPhotoView(id=photo.id, width=photo.width, height=photo.height)


def _view(db: Session, diary: ActivityDiary | None) -> DiaryDetail:
    if diary is None:
        return DiaryDetail(diary=None)
    photos = db.scalars(
        select(ActivityDiaryPhoto)
        .where(ActivityDiaryPhoto.diary_id == diary.id, ActivityDiaryPhoto.user_id == diary.user_id)
        .order_by(ActivityDiaryPhoto.created_at, ActivityDiaryPhoto.id)
    )
    return DiaryDetail(
        diary=DiaryView(
            mood=diary.mood,
            rpe=diary.rpe,
            weather=diary.weather,
            notes=diary.notes,
            photos=[_photo_view(photo) for photo in photos],
        )
    )


def detail(db: Session, owner: UUID, activity_id: UUID) -> DiaryDetail:
    owned_activity(db, owner, activity_id)
    return _view(db, _find_diary(db, owner, activity_id))


def _get_or_create(db: Session, owner: UUID, activity_id: UUID) -> ActivityDiary:
    diary = _find_diary(db, owner, activity_id)
    if diary is None:
        diary = ActivityDiary(user_id=owner, activity_id=activity_id)
        db.add(diary)
        db.flush()
    return diary


def save(
    db: Session, owner: UUID, activity_id: UUID, values: DiaryInput, now: datetime
) -> DiaryDetail:
    lock_owner(db, owner)
    owned_activity(db, owner, activity_id)
    diary = _get_or_create(db, owner, activity_id)
    diary.mood = values.mood
    diary.rpe = values.rpe
    diary.weather = values.weather
    diary.notes = values.notes
    diary.updated_at = now
    db.flush()
    return _view(db, diary)


def delete(db: Session, owner: UUID, activity_id: UUID) -> None:
    lock_owner(db, owner)
    owned_activity(db, owner, activity_id)
    diary = _find_diary(db, owner, activity_id)
    if diary is not None:
        db.delete(diary)
        db.flush()


def add_photo(db: Session, owner: UUID, activity_id: UUID, image: ProcessedImage) -> DiaryPhotoView:
    lock_owner(db, owner)
    owned_activity(db, owner, activity_id)
    diary = _get_or_create(db, owner, activity_id)
    count = db.execute(
        select(func.count())
        .select_from(ActivityDiaryPhoto)
        .where(ActivityDiaryPhoto.diary_id == diary.id, ActivityDiaryPhoto.user_id == owner)
    ).scalar_one()
    if count >= MAX_PHOTOS:
        raise ApiError(409, "DIARY_PHOTO_LIMIT", "每篇日记最多添加 6 张照片")
    photo = ActivityDiaryPhoto(
        user_id=owner, diary_id=diary.id, png=image.png, width=image.width, height=image.height
    )
    db.add(photo)
    db.flush()
    return _photo_view(photo)


def _owned_photo(db: Session, owner: UUID, activity_id: UUID, photo_id: UUID) -> ActivityDiaryPhoto:
    photo = db.scalar(
        select(ActivityDiaryPhoto)
        .join(
            ActivityDiary,
            (ActivityDiary.id == ActivityDiaryPhoto.diary_id)
            & (ActivityDiary.user_id == ActivityDiaryPhoto.user_id),
        )
        .where(
            ActivityDiary.activity_id == activity_id,
            ActivityDiaryPhoto.user_id == owner,
            ActivityDiaryPhoto.id == photo_id,
        )
    )
    if photo is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "照片不存在")
    return photo


def read_photo(db: Session, owner: UUID, activity_id: UUID, photo_id: UUID) -> bytes:
    return _owned_photo(db, owner, activity_id, photo_id).png


def delete_photo(db: Session, owner: UUID, activity_id: UUID, photo_id: UUID) -> None:
    lock_owner(db, owner)
    db.delete(_owned_photo(db, owner, activity_id, photo_id))
    db.flush()
