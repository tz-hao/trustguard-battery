from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Measurement(StrictModel):
    asset_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
    batch_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
    chemistry: Literal["LFP", "TERNARY"]
    model: str = Field(min_length=1, max_length=100)
    condition: str = Field(min_length=1, max_length=100)
    # Engineering measurements, not monetary or chain asset amounts.
    capacity_mah: float | None = Field(default=None, gt=0, le=1_000_000)
    resistance_uohm: float | None = Field(default=None, gt=0, le=10_000_000)
    voltage_mv: float | None = Field(default=None, gt=0, le=10_000)
    temperature_c: float | None = Field(default=None, ge=-80, le=150)
    source_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    simulation: bool

    @property
    def group(self) -> tuple[str, str, str]:
        return self.chemistry, self.model, self.condition

    def features(self) -> list[float] | None:
        values = [self.capacity_mah, self.resistance_uohm, self.voltage_mv, self.temperature_c]
        if any(v is None or not math.isfinite(v) for v in values):
            return None
        return [float(v) for v in values]


class QualityRequest(StrictModel):
    measurements: list[Measurement] = Field(min_length=1, max_length=1000)


class Operation(StrictModel):
    actor_msp: str = Field(min_length=1, max_length=96)
    target_msp: str | None = Field(default=None, max_length=96)
    action: str = Field(min_length=1, max_length=96)
    at: datetime
    rejected: bool = False
    report_reversal: bool = False
    approval_latency_seconds: int | None = Field(default=None, ge=0)

    @field_validator("at")
    @classmethod
    def aware_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("timezone required")
        return value.astimezone(timezone.utc)


class OperationRequest(StrictModel):
    operations: list[Operation] = Field(max_length=5000)
    as_of: datetime

    @field_validator("as_of")
    @classmethod
    def aware_time(cls, value: datetime) -> datetime:
        return Operation.aware_time(value)


class AttestationRequest(StrictModel):
    requestId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
    assetId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
    snapshotHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    policyVersion: int = Field(ge=1)
    quality_review_required: bool
    operation_review_required: bool
    evidenceHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    ttl_seconds: int = Field(default=300, ge=30, le=900)


class CsvImportRequest(StrictModel):
    sourceId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
    batchId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
    issuedAt: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
    contentBase64: str = Field(max_length=6_000_000)
    signature: str = Field(max_length=256)


class SignedHealthRequest(StrictModel):
    sourceId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
    id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
    assetId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
    measuredAt: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
    sohBasisPoints: int = Field(ge=0,le=10000,strict=True)
    cycleCount: int = Field(ge=0,le=2147483647,strict=True)
    simulation: bool = Field(strict=True)
    signature: str = Field(max_length=256)
