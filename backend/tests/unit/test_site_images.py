from io import BytesIO

import pytest
from PIL import ExifTags, Image

from app.core.errors import ApiError
from app.modules.site_settings import images
from app.modules.site_settings.images import image_version, normalize_image

MALFORMED_EXIF = b"Exif\x00\x00II*\x00"


def encoded(size=(100, 60), fmt="PNG", color=(200, 30, 30), **kwargs):
    buffer = BytesIO()
    Image.new("RGB", size, color).save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


def test_jpeg_metadata_is_removed_and_output_is_clean_png():
    exif = Image.Exif()
    exif[ExifTags.Base.ImageDescription] = "synthetic-secret-marker"
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    gps[ExifTags.GPS.GPSLatitudeRef] = "N"
    gps[ExifTags.GPS.GPSLatitude] = (31.0, 14.0, 0.0)
    raw = encoded((120, 120), "JPEG", exif=exif.tobytes())
    assert b"synthetic-secret-marker" in raw
    result = normalize_image(raw, "avatar")
    assert result.png.startswith(b"\x89PNG\r\n\x1a\n")
    assert b"synthetic-secret-marker" not in result.png
    with Image.open(BytesIO(result.png)) as image:
        assert image.format == "PNG"
        assert not image.getexif()
        assert not ({"exif", "icc_profile", "dpi"} & set(image.info))
        assert not getattr(image, "text", {})


@pytest.mark.parametrize(
    "purpose,size,expected",
    [("avatar", (100, 60), 60), ("logo", (600, 400), 256), ("favicon", (300, 900), 64)],
)
def test_center_crop_square_without_upscaling(purpose, size, expected):
    result = normalize_image(encoded(size), purpose)
    assert (result.width, result.height) == (expected, expected)
    with Image.open(BytesIO(result.png)) as image:
        assert image.size == (expected, expected)


def test_exif_orientation_is_applied_before_crop():
    # Orientation 6 displays the 40x80 source rotated 90 degrees clockwise (80x40), so the
    # source's left half (red) ends up on top and its right half (blue) at the bottom.
    source = Image.new("RGB", (40, 80), (0, 0, 255))
    source.paste((255, 0, 0), (0, 0, 20, 80))
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = 6
    buffer = BytesIO()
    source.save(buffer, format="JPEG", exif=exif.tobytes(), quality=95)
    result = normalize_image(buffer.getvalue(), "avatar")
    assert (result.width, result.height) == (40, 40)
    with Image.open(BytesIO(result.png)) as image:
        top = image.convert("RGB").getpixel((30, 5))
        bottom = image.convert("RGB").getpixel((10, 35))
    assert top[0] > 150 and top[2] < 100, top
    assert bottom[2] > 150 and bottom[0] < 100, bottom


def test_mpo_jpeg_is_accepted_using_first_frame():
    buffer = BytesIO()
    first = Image.new("RGB", (100, 60), (200, 30, 30))
    first.save(
        buffer,
        format="MPO",
        save_all=True,
        append_images=[Image.new("RGB", (100, 60), (0, 0, 255))],
    )
    raw = buffer.getvalue()
    with Image.open(BytesIO(raw)) as probe:
        assert probe.format == "MPO"
    result = normalize_image(raw, "avatar")
    assert (result.width, result.height) == (60, 60)
    with Image.open(BytesIO(result.png)) as image:
        red, _, blue = image.convert("RGB").getpixel((30, 30))
    assert red > 150 and blue < 100


def test_version_and_hash_are_stable():
    raw = encoded()
    first, second = normalize_image(raw, "logo"), normalize_image(raw, "logo")
    assert first.sha256 == second.sha256 and len(first.sha256) == 64
    assert image_version(first.sha256) == first.sha256[:16]


@pytest.mark.parametrize(
    "raw,status,code",
    [
        (encoded(fmt="GIF"), 415, "IMAGE_UNSUPPORTED"),
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 415, "IMAGE_UNSUPPORTED"),
        (encoded()[: len(encoded()) // 2], 422, "IMAGE_INVALID"),
        (b"", 422, "IMAGE_INVALID"),
        (encoded((20, 200)), 422, "IMAGE_INVALID"),
        (encoded(fmt="PNG", exif=MALFORMED_EXIF), 422, "IMAGE_INVALID"),
        (encoded(fmt="WEBP", exif=MALFORMED_EXIF), 422, "IMAGE_INVALID"),
        (b"\0" * (5 * 1024 * 1024 + 1), 413, "IMAGE_TOO_LARGE"),
    ],
)
def test_rejections(raw, status, code):
    with pytest.raises(ApiError) as error:
        normalize_image(raw, "avatar")
    assert (error.value.status_code, error.value.code) == (status, code)


def test_decompression_bomb_is_rejected(monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    with pytest.raises(ApiError) as error:
        normalize_image(encoded((40, 40)), "avatar")  # 1600 px: above the limit
    assert error.value.code == "IMAGE_TOO_LARGE"
    assert images.MAX_IMAGE_BYTES == 5 * 1024 * 1024
