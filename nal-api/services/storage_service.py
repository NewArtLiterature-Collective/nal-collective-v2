# nal-api/services/storage_service.py
# ============================================================================
# 文件存储：Cloudflare R2（S3 兼容接口），取代 Supabase Storage（2026-11）
#
# 每个环境两个桶（v2 与生产各自一套，互不相通）：
#   · 私有桶 R2_PRIVATE_BUCKET（不开公开访问）
#       contest_works/<对象名>              参赛配图（数据库 image_urls 里只存 <对象名>）
#       eval_uploads/<用户ID>/<文件名>      日常评审上传的图片（临时，建议在 R2 设生命周期 30 天自动删除）
#     读取一律由后端生成限时签名链接。
#   · 公开桶 R2_PUBLIC_BUCKET（绑定自定义域名，例如 https://media.nal-ai.org）
#       showcase/<作品ID>/<页>.jpg         陈伯吹新儿童文学绘本插画大赛厅展品（数据库 pages 里只存 <作品ID>/<页>.jpg）
#
# 环境变量：R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、
#           R2_PRIVATE_BUCKET、R2_PUBLIC_BUCKET、R2_PUBLIC_BASE_URL
# ============================================================================

import os
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

CONTEST_PREFIX = "contest_works/"
EVAL_PREFIX = "eval_uploads/"
SHOWCASE_PREFIX = "showcase/"


def _env(name: str) -> str:
    v = "".join((os.getenv(name) or "").split())
    if not v:
        raise RuntimeError(f"未配置环境变量 {name}（Cloudflare R2）")
    return v


@lru_cache(maxsize=1)
def _client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{_env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
        aws_access_key_id=_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
    )


def private_bucket() -> str:
    return _env("R2_PRIVATE_BUCKET")


def public_bucket() -> str:
    return _env("R2_PUBLIC_BUCKET")


def contest_object_name(url_or_path: str) -> str:
    """数据库里的参赛图片可能是旧的 Supabase 完整网址，也可能只是对象名：统一取出对象名。"""
    if not url_or_path:
        return ""
    marker = "/contest_works/"
    if marker in url_or_path:
        return url_or_path.split(marker, 1)[1].split("?", 1)[0]
    return url_or_path.lstrip("/")


# ---------------- 通用操作 ----------------
def put(bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream"):
    _client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)


def get(bucket: str, key: str) -> bytes:
    return _client().get_object(Bucket=bucket, Key=key)["Body"].read()


def exists(bucket: str, key: str) -> bool:
    try:
        _client().head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def delete(bucket: str, keys: list):
    keys = [k for k in keys if k]
    for i in range(0, len(keys), 1000):
        _client().delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]], "Quiet": True})


def list_keys(bucket: str, prefix: str) -> list:
    out, token = [], None
    while True:
        kw = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        res = _client().list_objects_v2(**kw)
        out += [o["Key"] for o in res.get("Contents", [])]
        if not res.get("IsTruncated"):
            return out
        token = res.get("NextContinuationToken")


def signed_get_url(bucket: str, key: str, ttl: int = 3600) -> str:
    return _client().generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=ttl)


def public_url(key: str) -> str:
    return f"{_env('R2_PUBLIC_BASE_URL').rstrip('/')}/{key}"


# ---------------- 业务封装 ----------------
def put_contest_image(object_name: str, data: bytes, content_type: str):
    put(private_bucket(), CONTEST_PREFIX + object_name, data, content_type)


def get_contest_image(url_or_path: str) -> bytes:
    return get(private_bucket(), CONTEST_PREFIX + contest_object_name(url_or_path))


def sign_contest_image(url_or_path: str, ttl: int = 3600) -> str:
    name = contest_object_name(url_or_path)
    return signed_get_url(private_bucket(), CONTEST_PREFIX + name, ttl) if name else ""


def delete_contest_images(urls_or_paths: list):
    delete(private_bucket(), [CONTEST_PREFIX + contest_object_name(u) for u in urls_or_paths if contest_object_name(u)])


def put_eval_upload(user_id: str, filename: str, data: bytes, content_type: str) -> str:
    key = f"{EVAL_PREFIX}{user_id}/{filename}"
    put(private_bucket(), key, data, content_type)
    return key


def delete_eval_uploads(user_id: str) -> int:
    keys = list_keys(private_bucket(), f"{EVAL_PREFIX}{user_id}/")
    delete(private_bucket(), keys)
    return len(keys)


def put_showcase(path: str, data: bytes, content_type: str = "image/jpeg"):
    put(public_bucket(), SHOWCASE_PREFIX + path.lstrip("/"), data, content_type)


def get_showcase(path: str) -> bytes:
    return get(public_bucket(), SHOWCASE_PREFIX + path.lstrip("/"))


def delete_showcase(paths: list):
    delete(public_bucket(), [SHOWCASE_PREFIX + p.lstrip("/") for p in paths if p])
