from pydantic import Field, field_validator, model_validator

from app.modules.auth.schema import LoginInput, RegisterInput
from app.modules.users.schema import StrictInput, UserView, valid_timezone


class AdminUser(UserView):
    is_active: bool


class AdminUserList(StrictInput):
    items: list[AdminUser]
    total: int
    limit: int
    offset: int


class UserCreate(RegisterInput):
    display_name: str = Field(min_length=1, max_length=80)
    is_active: bool = True
    showcase_enabled: bool = False


class UserPatch(StrictInput):
    email: str = Field(default=None, max_length=254)
    display_name: str = Field(default=None, min_length=1, max_length=80)
    timezone: str = Field(default=None, min_length=1, max_length=64)
    bio: str = Field(default=None, max_length=500)
    is_active: bool = Field(default=None)
    showcase_enabled: bool = Field(default=None)

    normalize_email = field_validator("email", mode="before")(LoginInput.normalize_email.__func__)
    timezone_valid = field_validator("timezone")(valid_timezone)

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one allowed field required")
        return self


class PasswordReset(StrictInput):
    new_password: str = Field(min_length=12, max_length=128)


class PasswordResetResult(StrictInput):
    password_reset: bool = True
