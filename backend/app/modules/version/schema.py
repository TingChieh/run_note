from app.core.responses import ExactView


class VersionBuild(ExactView):
    release_id: str
    git_sha: str
    built_at: str


class VersionInfo(ExactView):
    version: str
    build: VersionBuild | None
