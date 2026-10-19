from sqlalchemy import select

from app.core.errors import ApiError
from app.modules.site_settings.images import image_version, normalize_image
from app.modules.site_settings.model import SiteImage, SiteSettings
from app.modules.site_settings.schema import SiteView

KINDS = ("favicon", "logo")


def settings_row(db, lock=False):
    query = select(SiteSettings).where(SiteSettings.id == 1)
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise ApiError(503, "SITE_SETTINGS_UNAVAILABLE", "站点设置尚未初始化，请联系站点管理员")
    return row


def site_view(db, row):
    versions = dict(db.execute(select(SiteImage.kind, SiteImage.sha256)).all())
    url = {
        kind: f"/api/v1/site/images/{kind}?v={image_version(versions[kind])}"
        if kind in versions
        else None
        for kind in KINDS
    }
    return SiteView(
        title=row.title,
        subtitle=row.subtitle,
        footer_tagline=row.footer_tagline,
        description=row.description,
        default_theme=row.default_theme,
        favicon_url=url["favicon"],
        logo_url=url["logo"],
    )


def read_site(db):
    return site_view(db, settings_row(db))


def update_site(db, payload):
    row = settings_row(db, lock=True)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.flush()
    return site_view(db, row)


def checked_kind(kind):
    if kind not in KINDS:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "图片不存在")
    return kind


def put_image(db, kind, raw):
    processed = normalize_image(raw, checked_kind(kind))
    row = settings_row(db, lock=True)  # Serialize concurrent site writes.
    image = db.get(SiteImage, kind)
    if image is None:
        image = SiteImage(kind=kind)
        db.add(image)
    image.png_bytes, image.sha256 = processed.png, processed.sha256
    image.width, image.height = processed.width, processed.height
    db.flush()
    return site_view(db, row)


def remove_image(db, kind):
    row = settings_row(db, lock=True)
    image = db.get(SiteImage, checked_kind(kind))
    if image is not None:
        db.delete(image)
        db.flush()
    return site_view(db, row)


def image_bytes(db, kind):
    data = db.scalar(select(SiteImage.png_bytes).where(SiteImage.kind == checked_kind(kind)))
    if data is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "图片不存在")
    return data
