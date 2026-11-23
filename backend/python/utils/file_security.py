"""
Safe fetching of document files.

The server must never fetch an arbitrary URL on a caller's behalf (SSRF). A file
URL is only accepted if it points at our own storage bucket:

  * https only, no embedded credentials, default port
  * host is exactly one of Config.ALLOWED_FILE_HOSTS
  * path is inside the public "documents" bucket
  * redirects are NOT followed (a redirect could point anywhere)
  * download time and size are capped, and the payload must be a real PDF
"""
from urllib.parse import urlsplit, unquote

import aiohttp

from config import Config

# Supabase public-object path for the "documents" bucket
REQUIRED_PATH_PREFIX = "/storage/v1/object/public/documents/"
MAX_URL_LENGTH = 2048
_CHUNK = 64 * 1024


class UnsafeFileUrl(ValueError):
    """The URL is not an allowed document-storage URL."""


class FileTooLarge(ValueError):
    """The file exceeds Config.MAX_PDF_BYTES."""


class InvalidPdf(ValueError):
    """The payload is not an acceptable PDF."""


class DownloadFailed(RuntimeError):
    """The storage server could not be reached or refused the request."""


def validate_file_url(url) -> str:
    """Return the URL unchanged if it is an allowed storage URL, else raise UnsafeFileUrl."""
    if not isinstance(url, str) or not url or len(url) > MAX_URL_LENGTH:
        raise UnsafeFileUrl("File URL is missing or too long")

    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise UnsafeFileUrl("File URL is malformed")

    if parts.scheme != "https":
        raise UnsafeFileUrl("File URL must use https")
    if parts.username is not None or parts.password is not None:
        raise UnsafeFileUrl("File URL must not contain credentials")
    if port not in (None, 443):
        raise UnsafeFileUrl("File URL must use the default port")

    host = (parts.hostname or "").lower()
    if host not in Config.ALLOWED_FILE_HOSTS:
        raise UnsafeFileUrl("File URL host is not allowed")

    if not parts.path.startswith(REQUIRED_PATH_PREFIX):
        raise UnsafeFileUrl("File URL path is not inside the documents bucket")
    decoded_segments = unquote(parts.path).replace("\\", "/").split("/")
    if ".." in decoded_segments:
        raise UnsafeFileUrl("File URL path is not allowed")

    return url


async def _fetch_pdf(url: str) -> bytes:
    """
    Download `url` with a time limit, no redirects and a hard size cap.
    Does NOT validate the URL; call download_pdf() instead.
    """
    max_bytes = Config.MAX_PDF_BYTES
    timeout = aiohttp.ClientTimeout(total=Config.DOWNLOAD_TIMEOUT_SECONDS)

    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, allow_redirects=False) as response:
                if response.status != 200:
                    # Includes 3xx: redirects are deliberately not followed
                    raise DownloadFailed(f"Storage returned HTTP {response.status}")

                declared = response.content_length
                if declared is not None and declared > max_bytes:
                    raise FileTooLarge(f"File exceeds {max_bytes} bytes")

                data = bytearray()
                async for chunk in response.content.iter_chunked(_CHUNK):
                    data.extend(chunk)
                    if len(data) > max_bytes:
                        raise FileTooLarge(f"File exceeds {max_bytes} bytes")
    except (aiohttp.ClientError, TimeoutError) as e:
        raise DownloadFailed(f"Could not download file: {type(e).__name__}")

    if not bytes(data[:5]) == b"%PDF-":
        raise InvalidPdf("File is not a PDF")
    return bytes(data)


async def download_pdf(url) -> bytes:
    """Validate the URL against the allow-list, then download it safely."""
    return await _fetch_pdf(validate_file_url(url))
