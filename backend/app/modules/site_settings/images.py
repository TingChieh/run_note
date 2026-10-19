"""Decode, orient, square-crop and re-encode uploads as metadata-free PNG."""

import warnings
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from typing import Literal

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import ApiError

Image.MAX_IMAGE_PIXELS = 40_000_000
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MIN_SIDE = 32
SIZES = {"avatar": 512, "logo": 256, "favicon": 64}
# Pillow reports JPEGs carrying an MPF extension (multi-picture, gain-map photos) as MPO.
FORMATS = {"PNG", "JPEG", "MPO", "WEBP"}
DRAFT_SIDE = 1024
Purpose = Literal["avatar", "logo", "favicon"]


@dataclass(frozen=True)
class ProcessedImage:
    png: bytes
    width: int
    height: int
    sha256: str


def image_version(digest: str) -> str:
    return digest[:16]


def too_large():
    return ApiError(413, "IMAGE_TOO_LARGE", "图片不能超过 5 MiB")


def decode(raw: bytes) -> Image.Image:
    """Return a loaded, orientation-corrected RGBA image (first frame only)."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as source:
                if source.format not in FORMATS:
                    raise ApiError(415, "IMAGE_UNSUPPORTED", "仅支持 PNG、JPEG 或 WebP 图片")
                # Explicit check: the warnings filter above is process-global, not thread-safe.
                if source.width * source.height > Image.MAX_IMAGE_PIXELS:
                    raise ApiError(422, "IMAGE_TOO_LARGE", "图片像素过多，请缩小后再上传")
                if source.format in {"JPEG", "MPO"}:
                    source.draft(None, (DRAFT_SIDE, DRAFT_SIDE))  # Decode at reduced scale.
                source.load()
                return ImageOps.exif_transpose(source).convert("RGBA")
    except ApiError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ApiError(422, "IMAGE_TOO_LARGE", "图片像素过多，请缩小后再上传") from None
    except UnidentifiedImageError:
        raise ApiError(415, "IMAGE_UNSUPPORTED", "仅支持 PNG、JPEG 或 WebP 图片") from None
    except Exception:  # Malformed EXIF raises struct.error, among others.
        raise ApiError(422, "IMAGE_INVALID", "图片无法读取，请换一张") from None


def normalize_image(raw: bytes, purpose: Purpose) -> ProcessedImage:
    if len(raw) > MAX_IMAGE_BYTES:
        raise too_large()
    if not raw:
        raise ApiError(422, "IMAGE_INVALID", "图片无法读取，请换一张")
    image = decode(raw)
    side = min(image.size)
    if side < MIN_SIDE:
        raise ApiError(422, "IMAGE_INVALID", "图片尺寸过小，最短边至少 32 像素")
    left, top = (image.width - side) // 2, (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side))
    target = min(side, SIZES[purpose])
    if target != side:
        image = image.resize((target, target), Image.Resampling.LANCZOS)
    image.info.clear()  # Never carry ICC, EXIF, text or DPI from the source.
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    png = buffer.getvalue()
    return ProcessedImage(png=png, width=target, height=target, sha256=sha256(png).hexdigest())
