from email_validator import EmailNotValidError, validate_email
from pydantic import Field, field_validator

from app.modules.users.schema import StrictInput, UserView, valid_timezone


class LoginInput(StrictInput):
    email: str = Field(max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        if not isinstance(value, str):
            raise ValueError("Email must be a string")
        normalized = value.strip().lower()
        try:
            validate_email(normalized, check_deliverability=False)
        except EmailNotValidError:
            raise ValueError("Valid email required") from None
        return normalized


class RegisterInput(LoginInput):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[a-z0-9_]+$")
    timezone: str = Field(default="Asia/Shanghai", max_length=64)

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, value):
        return valid_timezone(value)


class CsrfView(StrictInput):
    csrf_token: str


class AuthView(CsrfView):
    user: UserView


class SessionView(StrictInput):
    authenticated: bool = True
    user: UserView


class LogoutView(StrictInput):
    logged_out: bool = True
