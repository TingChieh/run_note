from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.modules.users.schema import StrictInput

Theme = Literal["system", "light", "dark"]


class SiteView(BaseModel):
    title: str
    subtitle: str
    footer_tagline: str
    description: str
    default_theme: Theme
    favicon_url: str | None
    logo_url: str | None


class SitePatch(StrictInput):
    title: str = Field(default=None, max_length=40)
    subtitle: str = Field(default=None, max_length=40)
    footer_tagline: str = Field(default=None, max_length=80)
    description: str = Field(default=None, max_length=200)
    default_theme: Theme = Field(default=None)

    @field_validator("title", "subtitle", "footer_tagline", "description", mode="before")
    @classmethod
    def strip(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("title")
    @classmethod
    def title_present(cls, value):
        if not value:
            raise ValueError("Site title required")
        return value

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one allowed field required")
        return self
