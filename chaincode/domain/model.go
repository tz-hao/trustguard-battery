package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"time"
)

const (
	CellOrg    = "CellOrgMSP"
	PackOrg    = "PackOrgMSP"
	LabOrg     = "LabOrgMSP"
	RecycleOrg = "RecycleOrgMSP"
	AuditOrg   = "AuditOrgMSP"
)

var Organizations = []string{CellOrg, PackOrg, LabOrg, RecycleOrg}
var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$`)
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var codePattern = regexp.MustCompile(`^[A-Z0-9]{24}$`)

type Actor struct{ MSP, ID, Role string }
type Command struct {
	RequestID string          `json:"requestId"`
	Action    string          `json:"action"`
	Data      json.RawMessage `json:"data"`
}
type Result struct {
	RequestID  string `json:"requestId"`
	TxID       string `json:"txId"`
	Action     string `json:"action"`
	ResourceID string `json:"resourceId"`
	Version    uint64 `json:"version"`
}
type Receipt struct {
	Digest string `json:"digest"`
	Result Result `json:"result"`
}
type Evidence struct {
	RequestID   string `json:"requestId"`
	Action      string `json:"action"`
	ResourceID  string `json:"resourceId"`
	ActorMSP    string `json:"actorMSP"`
	ActorID     string `json:"actorId"`
	TxID        string `json:"txId"`
	At          string `json:"at"`
	Version     uint64 `json:"version"`
	PayloadHash string `json:"payloadHash"`
}
type Maker struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	MSP        string `json:"msp"`
	Simulation bool   `json:"simulation"`
	SourceHash string `json:"sourceHash"`
}
type Batch struct {
	ID             string   `json:"id"`
	MakerMSP       string   `json:"makerMSP"`
	MaterialLotIDs []string `json:"materialLotIds"`
	Simulation     bool     `json:"simulation"`
}
type MaterialLot struct {
	ID         string `json:"id"`
	OwnerMSP   string `json:"ownerMSP"`
	SourceHash string `json:"sourceHash"`
	Simulation bool   `json:"simulation"`
}
type Asset struct {
	ID                    string   `json:"id"`
	Code                  string   `json:"code"`
	Type                  string   `json:"type"`
	MakerCode             string   `json:"makerCode"`
	MakerMSP              string   `json:"makerMSP"`
	Chemistry             string   `json:"chemistry"`
	BatchID               string   `json:"batchId,omitempty"`
	Model                 string   `json:"model"`
	HolderMSP             string   `json:"holderMSP"`
	Simulation            bool     `json:"simulation"`
	ManufacturedAt        string   `json:"manufacturedAt"`
	ManufactureSourceHash string   `json:"manufactureSourceHash"`
	DesignLifeMonths      *uint32  `json:"designLifeMonths"`
	SpecSourceHash        string   `json:"specSourceHash,omitempty"`
	State                 string   `json:"state"`
	Quality               string   `json:"quality"`
	Version               uint64   `json:"version"`
	AssemblyVersion       uint64   `json:"assemblyVersion"`
	ParentID              string   `json:"parentId,omitempty"`
	Children              []string `json:"children"`
	InspectionVersion     uint64   `json:"inspectionVersion"`
	InstalledAt           *string  `json:"installedAt"`
	FirstUseAt            *string  `json:"firstUseAt"`
	RetiredAt             *string  `json:"retiredAt"`
	RecyclingReceivedAt   *string  `json:"recyclingReceivedAt"`
	ScrappedAt            *string  `json:"scrappedAt"`
	UpdatedAt             string   `json:"updatedAt"`
	TxID                  string   `json:"txId"`
}
type Inspection struct {
	ID         string `json:"id"`
	AssetID    string `json:"assetId"`
	Version    uint64 `json:"version"`
	Result     string `json:"result"`
	ReportHash string `json:"reportHash"`
	SourceHash string `json:"sourceHash"`
	SignerMSP  string `json:"signerMSP"`
	SignerID   string `json:"signerId"`
	At         string `json:"at"`
	TxID       string `json:"txId"`
}
type Edge struct {
	ID         string  `json:"id"`
	ParentID   string  `json:"parentId"`
	ChildID    string  `json:"childId"`
	Revision   uint64  `json:"revision"`
	ActiveFrom string  `json:"activeFrom"`
	ActiveTo   *string `json:"activeTo"`
	TxID       string  `json:"txId"`
}
type Approval struct {
	MSP     string `json:"msp"`
	ActorID string `json:"actorId"`
	Digest  string `json:"digest"`
	At      string `json:"at"`
}
type Release struct {
	ID            string     `json:"id"`
	PackID        string     `json:"packId"`
	SnapshotHash  string     `json:"snapshotHash"`
	PolicyVersion uint64     `json:"policyVersion"`
	RequiredOrgs  []string   `json:"requiredOrgs"`
	Approvals     []Approval `json:"approvals"`
	Risk          Risk       `json:"risk"`
	State         string     `json:"state"`
	ExpiresAt     string     `json:"expiresAt"`
}
type Transfer struct {
	ID           string `json:"id"`
	PackID       string `json:"packId"`
	FromMSP      string `json:"fromMSP"`
	ToMSP        string `json:"toMSP"`
	ReceiptHash  string `json:"receiptHash"`
	State        string `json:"state"`
	AssetVersion uint64 `json:"assetVersion"`
	ExpiresAt    string `json:"expiresAt"`
	SenderID     string `json:"senderId"`
	ReceiverID   string `json:"receiverId,omitempty"`
	CreatedTx    string `json:"createdTx,omitempty"`
	SentTx       string `json:"sentTx,omitempty"`
	AcceptedTx   string `json:"acceptedTx,omitempty"`
	CommittedTx  string `json:"committedTx,omitempty"`
	CancelledTx  string `json:"cancelledTx,omitempty"`
}
type Risk struct {
	ID            string `json:"id"`
	RequestID     string `json:"requestId"`
	AssetID       string `json:"assetId"`
	SnapshotHash  string `json:"snapshotHash"`
	PolicyVersion uint64 `json:"policyVersion"`
	ModelVersion  string `json:"modelVersion"`
	Level         string `json:"level"`
	EvidenceHash  string `json:"evidenceHash"`
	IssuedAt      string `json:"issuedAt"`
	ExpiresAt     string `json:"expiresAt"`
	SignerID      string `json:"signerId"`
	Signature     string `json:"signature"`
}
type Policy struct {
	Version        uint64            `json:"version"`
	RequiredOrgs   []string          `json:"requiredOrgs"`
	HighRiskOrgs   []string          `json:"highRiskOrgs"`
	RiskKeys       map[string]string `json:"riskKeys"`
	MaxRiskSeconds uint32            `json:"maxRiskSeconds"`
	ReleaseSeconds uint32            `json:"releaseSeconds"`
	SimulationOnly bool              `json:"simulationOnly"`
}
type PolicyCandidate struct {
	ID          string     `json:"id"`
	Policy      Policy     `json:"policy"`
	TestsHash   string     `json:"testsHash"`
	BaseVersion uint64     `json:"baseVersion"`
	State       string     `json:"state"`
	Approvals   []Approval `json:"approvals"`
}

func fail(code, message string) error { return fmt.Errorf("%s: %s", code, message) }
func Digest(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func validID(s string) error {
	if !idPattern.MatchString(s) {
		return fail("INVALID_ID", "invalid identifier")
	}
	return nil
}
func validHash(s string) error {
	if !hashPattern.MatchString(s) {
		return fail("INVALID_HASH", "expected lowercase sha256 digest")
	}
	return nil
}
func knownOrg(s string) bool {
	for _, o := range Organizations {
		if o == s {
			return true
		}
	}
	return false
}
func parseTime(s string) (time.Time, error) {
	t, e := time.Parse(time.RFC3339, s)
	if e != nil || t.Format(time.RFC3339) != s || t.Location() != time.UTC {
		return time.Time{}, fail("INVALID_TIME", "expected canonical UTC RFC3339 seconds")
	}
	return t, nil
}
