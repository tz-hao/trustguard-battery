package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestTransferKeepsCustodyUntilSeparateCommit(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	initial, _ := f.engine.asset("pack1")
	in := TransferInput{"tr1", initial.ID, CellOrg, Digest("receipt"), f.engine.Now.Add(time.Hour).Format(time.RFC3339)}
	id, receipt := IDInput{in.ID}, ConfirmTransferInput{in.ID, in.ReceiptHash}
	created := f.call(PackOrg, "custodian", "CreateTransfer", in)
	check := func(state, owner string, version uint64) Transfer {
		t.Helper()
		row, err := read[Transfer](f.engine, "transfer:"+in.ID)
		pack, packErr := f.engine.asset(initial.ID)
		if err != nil || packErr != nil || row.State != state || pack.HolderMSP != owner || pack.Version != version {
			t.Fatalf("expected %s and %s at v%d, got %s and %s at v%d", state, owner, version, row.State, pack.HolderMSP, pack.Version)
		}
		return row
	}
	check("CREATED", PackOrg, initial.Version)
	f.reject(CellOrg, "custodian", "AcceptTransfer", receipt, "INVALID_TRANSFER_STATE")
	f.reject(CellOrg, "custodian", "SendTransfer", id, "FORBIDDEN")
	sent := f.call(PackOrg, "custodian", "SendTransfer", id)
	check("SENT", PackOrg, initial.Version)
	f.reject(CellOrg, "custodian", "ConfirmTransfer", receipt, "INVALID_TRANSFER_STATE")
	f.reject(CellOrg, "custodian", "AcceptTransfer", ConfirmTransferInput{in.ID, Digest("different receipt")}, "FORBIDDEN")
	accepted := f.call(CellOrg, "custodian", "AcceptTransfer", receipt)
	check("ACCEPTED", PackOrg, initial.Version)
	f.reject(PackOrg, "custodian", "CommitTransfer", id, "FORBIDDEN")
	committed := f.call(CellOrg, "custodian", "CommitTransfer", id)
	row := check("COMMITTED", CellOrg, initial.Version+1)
	if row.CreatedTx != created.TxID || row.SentTx != sent.TxID || row.AcceptedTx != accepted.TxID || row.CommittedTx != committed.TxID || row.SenderID == row.ReceiverID {
		t.Fatal("missing transfer signatures or step evidence")
	}
	replay, err := f.raw(CellOrg, "custodian", committed.RequestID, "CommitTransfer", id)
	if err != nil || replay != committed {
		t.Fatal("commit retry did not return original receipt")
	}
	check("COMMITTED", CellOrg, initial.Version+1)
}

func TestTransferCancellationExpiryAndAssetVersion(t *testing.T) {
	for _, test := range []string{"draft", "sent", "expired", "changed"} {
		t.Run(test, func(t *testing.T) {
			f := newFixture(t)
			f.assembled()
			in := TransferInput{"transfer", "pack1", CellOrg, Digest("receipt"), f.engine.Now.Add(time.Hour).Format(time.RFC3339)}
			id := IDInput{in.ID}
			f.call(PackOrg, "custodian", "CreateTransfer", in)
			next := in
			next.ID = "another"
			f.reject(PackOrg, "custodian", "CreateTransfer", next, "TRANSFER_PENDING")
			if test != "draft" {
				f.call(PackOrg, "custodian", "SendTransfer", id)
			}
			if test == "changed" || test == "expired" {
				f.call(CellOrg, "custodian", "AcceptTransfer", ConfirmTransferInput{in.ID, in.ReceiptHash})
				if test == "changed" {
					f.inspect("pack1", "QC_PASSED")
					f.reject(CellOrg, "custodian", "CommitTransfer", id, "STALE_TRANSFER")
				} else {
					f.engine.Now = f.engine.Now.Add(time.Hour)
					f.reject(CellOrg, "custodian", "CommitTransfer", id, "TRANSFER_EXPIRED")
				}
			}
			org := CellOrg
			if test == "draft" {
				org = PackOrg
			}
			r := f.call(org, "custodian", "CancelTransfer", id)
			row, _ := read[Transfer](f.engine, "transfer:"+in.ID)
			pack, _ := f.engine.asset(in.PackID)
			if row.State != "CANCELLED" || row.CancelledTx != r.TxID || pack.HolderMSP != PackOrg {
				t.Fatal("cancel changed custody or lost evidence")
			}
			next.ExpiresAt = f.engine.Now.Add(time.Hour).Format(time.RFC3339)
			f.call(PackOrg, "custodian", "CreateTransfer", next)
		})
	}
}

func TestV14SentRecordStillReadableAndCompletable(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	pack, _ := f.engine.asset("pack1")
	// Marshal the historical layout explicitly, without any newer fields.
	old, _ := json.Marshal(map[string]any{"id": "old", "packId": pack.ID, "fromMSP": PackOrg, "toMSP": CellOrg, "state": "SENT",
		"receiptHash": Digest("paper"), "assetVersion": pack.Version, "senderId": Digest("old sender"), "expiresAt": f.engine.Now.Add(time.Hour).Format(time.RFC3339)})
	f.store["transfer:old"] = old
	f.store["transfer-pending:pack1"] = []byte(`"old"`)
	if _, err := f.engine.Query([]byte(`{"kind":"transfer","id":"old"}`)); err != nil {
		t.Fatal(err)
	}
	result := f.call(CellOrg, "custodian", "ConfirmTransfer", ConfirmTransferInput{"old", Digest("paper")})
	row, _ := read[Transfer](f.engine, "transfer:old")
	pack, _ = f.engine.asset("pack1")
	if row.CreatedTx != "" || row.AcceptedTx != "" || row.CommittedTx != result.TxID || pack.HolderMSP != CellOrg {
		t.Fatal("legacy completion created fictitious history or lost custody")
	}
}

func TestIndependentAuditorAttestsWithoutBusinessAuthority(t *testing.T) {
	f := newFixture(t)
	in := AuditInput{"batch-audit", Digest("signed log batch"), 3}
	result := f.call(AuditOrg, "auditor", "AnchorAudit", in)
	proof, err := f.engine.Query([]byte(`{"kind":"auditAnchor","id":"batch-audit"}`))
	audit, _ := read[Evidence](f.engine, "audit:"+result.TxID)
	if err != nil || proof != (AuditAnchor{in, AuditOrg, result.TxID}) || audit.ActorMSP != AuditOrg {
		t.Fatal("independent evidence did not identify the audit MSP")
	}
	f.reject(AuditOrg, "auditor", "ApprovePolicy", IDInput{"candidate"}, "FORBIDDEN")
	f.reject(AuditOrg, "approver", "ApproveRelease", IDInput{"release"}, "FORBIDDEN")
	f.reject(AuditOrg, "custodian", "CreateTransfer", IDInput{"fake"}, "FORBIDDEN")
	if knownOrg(AuditOrg) {
		t.Fatal("audit MSP counted as a business organization")
	}
}
