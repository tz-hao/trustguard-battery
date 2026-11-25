package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestRegisterEchelonAssetLinksCodesAndBlocksScrapped(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	pack, err := f.engine.asset("pack1")
	if err != nil {
		t.Fatal(err)
	}
	echelonCode := pack.Code + "T01"
	reportHash := Digest("echelon-inspection-report")

	// Cannot repurpose an active/unretired pack held by PackOrg
	f.reject(RecycleOrg, "recycler", "RegisterEchelonAsset", map[string]any{
		"id": "ech-pack1", "originAssetId": "pack1", "code": echelonCode,
		"model": "ECH-ESS-50KWH", "reportHash": reportHash,
	}, "FORBIDDEN")

	// Release, retire, transfer to RecycleOrg via 4-stage custody flow, and receive for recycling
	f.release("LOW")
	retireAt := f.engine.Now.Add(-2 * time.Hour).Format(time.RFC3339)
	receiveAt := f.engine.Now.Add(-1 * time.Hour).Format(time.RFC3339)
	f.call(PackOrg, "operator", "RecordRetirement", map[string]any{"assetId": "pack1", "at": retireAt, "evidenceHash": Digest("retire")})
	tr := TransferInput{"tr-ech", "pack1", RecycleOrg, Digest("tr-receipt"), f.engine.Now.Add(time.Hour).Format(time.RFC3339)}
	f.call(PackOrg, "custodian", "CreateTransfer", tr)
	f.call(PackOrg, "custodian", "SendTransfer", IDInput{"tr-ech"})
	f.call(RecycleOrg, "custodian", "AcceptTransfer", ConfirmTransferInput{"tr-ech", tr.ReceiptHash})
	f.call(RecycleOrg, "custodian", "CommitTransfer", IDInput{"tr-ech"})
	f.call(RecycleOrg, "recycler", "ConfirmRecycling", map[string]any{"assetId": "pack1", "at": receiveAt, "evidenceHash": Digest("receive")})

	// Non-recycler role or non-RecycleOrg must be rejected
	f.reject(PackOrg, "operator", "RegisterEchelonAsset", map[string]any{
		"id": "ech-pack1", "originAssetId": "pack1", "code": echelonCode,
		"model": "ECH-ESS-50KWH", "reportHash": reportHash,
	}, "FORBIDDEN")

	// Invalid echelon code format must be rejected
	f.reject(RecycleOrg, "recycler", "RegisterEchelonAsset", map[string]any{
		"id": "ech-pack1", "originAssetId": "pack1", "code": "INVALID-CODE",
		"model": "ECH-ESS-50KWH", "reportHash": reportHash,
	}, "CODE_FORMAT")

	// Valid echelon registration succeeds and links both assets bidirectionally
	f.call(RecycleOrg, "recycler", "RegisterEchelonAsset", map[string]any{
		"id": "ech-pack1", "originAssetId": "pack1", "code": echelonCode,
		"model": "ECH-ESS-50KWH", "reportHash": reportHash,
	})

	updatedOrigin, err := f.engine.asset("pack1")
	if err != nil {
		t.Fatal(err)
	}
	if updatedOrigin.State != "PROCESSED" || updatedOrigin.ScrappedAt != nil || updatedOrigin.EchelonCode != echelonCode || updatedOrigin.EchelonAssetID != "ech-pack1" {
		t.Fatalf("unexpected origin state after echelon link: %+v", updatedOrigin)
	}

	echAsset, err := f.engine.asset("ech-pack1")
	if err != nil {
		t.Fatal(err)
	}
	if echAsset.OriginCode != pack.Code || echAsset.OriginAssetID != "pack1" || echAsset.State != "REGISTERED" || echAsset.HolderMSP != RecycleOrg {
		t.Fatalf("unexpected echelon asset: %+v", echAsset)
	}

	// Duplicate repurposing of the same origin asset must fail
	f.reject(RecycleOrg, "recycler", "RegisterEchelonAsset", map[string]any{
		"id": "ech-pack1-dup", "originAssetId": "pack1", "code": pack.Code + "T02",
		"model": "ECH-ESS-50KWH", "reportHash": reportHash,
	}, "INVALID_STATE")

	// Both code query and battery query support echelon codes
	f.engine.Actor = Actor{RecycleOrg, "recycler-1", "recycler"}
	qCode, _ := json.Marshal(Query{Kind: "code", ID: echelonCode})
	parsed, err := f.engine.Query(qCode)
	if err != nil {
		t.Fatalf("expected echelon code query to succeed: %v", err)
	}
	if p := parsed.(ParsedCode); p.CodeScope != "echelon-repurposed" || p.Code != echelonCode {
		t.Fatalf("unexpected parsed echelon code: %+v", p)
	}
	qBattery, _ := json.Marshal(Query{Kind: "battery", ID: echelonCode})
	queriedAsset, err := f.engine.Query(qBattery)
	if err != nil {
		t.Fatalf("expected echelon battery query to succeed: %v", err)
	}
	if a := queriedAsset.(Asset); a.ID != "ech-pack1" || a.OriginCode != pack.Code {
		t.Fatalf("unexpected queried echelon asset: %+v", a)
	}
}

func TestScrappedAssetCannotEnterEchelonUtilization(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	pack, _ := f.engine.asset("pack1")
	f.release("LOW")
	retireAt := f.engine.Now.Add(-3 * time.Hour).Format(time.RFC3339)
	receiveAt := f.engine.Now.Add(-2 * time.Hour).Format(time.RFC3339)
	scrapAt := f.engine.Now.Add(-1 * time.Hour).Format(time.RFC3339)
	f.call(PackOrg, "operator", "RecordRetirement", map[string]any{"assetId": "pack1", "at": retireAt, "evidenceHash": Digest("retire")})
	tr := TransferInput{"tr-scrap", "pack1", RecycleOrg, Digest("tr-scrap-receipt"), f.engine.Now.Add(time.Hour).Format(time.RFC3339)}
	f.call(PackOrg, "custodian", "CreateTransfer", tr)
	f.call(PackOrg, "custodian", "SendTransfer", IDInput{"tr-scrap"})
	f.call(RecycleOrg, "custodian", "AcceptTransfer", ConfirmTransferInput{"tr-scrap", tr.ReceiptHash})
	f.call(RecycleOrg, "custodian", "CommitTransfer", IDInput{"tr-scrap"})
	f.call(RecycleOrg, "recycler", "ConfirmRecycling", map[string]any{"assetId": "pack1", "at": receiveAt, "evidenceHash": Digest("receive")})
	f.call(RecycleOrg, "recycler", "RecordScrapConfirmation", map[string]any{"assetId": "pack1", "at": scrapAt, "evidenceHash": Digest("scrap")})

	f.reject(RecycleOrg, "recycler", "RegisterEchelonAsset", map[string]any{
		"id": "ech-scrapped", "originAssetId": "pack1", "code": pack.Code + "T01",
		"model": "ECH-ESS-50KWH", "reportHash": Digest("echelon-report"),
	}, "TERMINAL_STATE")
}
