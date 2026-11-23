package main

import (
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/hyperledger/fabric-chaincode-go/v2/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/v2/pkg/statebased"
	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
	pb "github.com/hyperledger/fabric-protos-go-apiv2/peer"
	"trustguard/battery/domain"
)

type ledger struct{ stub shim.ChaincodeStubInterface }

func (l ledger) Get(key string) ([]byte, error) { return l.stub.GetState(key) }
func (l ledger) Put(key string, value []byte) error {
	if err := l.stub.PutState(key, value); err != nil {
		return err
	}
	var orgs []string
	switch {
	case strings.HasPrefix(key, "asset:"):
		var a domain.Asset
		if err := json.Unmarshal(value, &a); err != nil {
			return err
		}
		orgs = []string{a.MakerMSP, domain.LabOrg, a.HolderMSP}
	case strings.HasPrefix(key, "inspection:"), strings.HasPrefix(key, "batch-report:"), strings.HasPrefix(key, "batch-latest:"), strings.HasPrefix(key, "retest:"):
		orgs = []string{domain.LabOrg}
	case strings.HasPrefix(key, "release:"):
		var r domain.Release
		if err := json.Unmarshal(value, &r); err != nil {
			return err
		}
		orgs = r.RequiredOrgs
	case strings.HasPrefix(key, "transfer:"):
		var t domain.Transfer
		if err := json.Unmarshal(value, &t); err != nil {
			return err
		}
		orgs = []string{t.FromMSP, t.ToMSP}
	case strings.HasPrefix(key, "correction:"):
		var c domain.LifecycleCorrection
		if err := json.Unmarshal(value, &c); err != nil {
			return err
		}
		orgs = c.RequiredOrgs
	case key == "policy:active":
		orgs = domain.Organizations
	}
	if len(orgs) == 0 {
		return nil
	}
	seen := map[string]bool{}
	unique := []string{}
	for _, org := range orgs {
		if !seen[org] {
			seen[org] = true
			unique = append(unique, org)
		}
	}
	ep, err := statebased.NewStateEP(nil)
	if err != nil {
		return err
	}
	if err = ep.AddOrgs(statebased.RoleTypePeer, unique...); err != nil {
		return err
	}
	policy, err := ep.Policy()
	if err != nil {
		return err
	}
	return l.stub.SetStateValidationParameter(key, policy)
}
func (l ledger) Scan(prefix string) ([][]byte, error) {
	it, err := l.stub.GetStateByRange(prefix, prefix+"\uffff")
	if err != nil {
		return nil, err
	}
	defer it.Close()
	rows := [][]byte{}
	for it.HasNext() {
		row, er := it.Next()
		if er != nil {
			return nil, er
		}
		rows = append(rows, row.Value)
	}
	return rows, nil
}

func (l ledger) History(key string) ([]domain.HistoryRecord, error) {
	it, err := l.stub.GetHistoryForKey(key)
	if err != nil {
		return nil, err
	}
	defer it.Close()
	records := []domain.HistoryRecord{}
	for it.HasNext() {
		entry, er := it.Next()
		if er != nil {
			return nil, er
		}
		at := ""
		if entry.Timestamp != nil {
			at = entry.Timestamp.AsTime().UTC().Format(time.RFC3339)
		}
		value := json.RawMessage(entry.Value)
		if entry.IsDelete {
			value = json.RawMessage("null")
		}
		record := domain.HistoryRecord{TxID: entry.TxId, At: at, Deleted: entry.IsDelete, Value: value}
		audit, err := l.Get("audit:" + entry.TxId)
		if err != nil {
			return nil, err
		}
		if audit != nil {
			var source domain.Evidence
			if err = json.Unmarshal(audit, &source); err != nil {
				return nil, err
			}
			record.ActorMSP = source.ActorMSP
			record.Action = source.Action
		}
		records = append(records, record)
		if len(records) > 200 {
			records = records[1:]
		}
	}
	return records, nil
}

type BatteryChaincode struct{}

func certificateTimeValid(cert *x509.Certificate, at time.Time) bool {
	return cert != nil && !at.Before(cert.NotBefore) && !at.After(cert.NotAfter)
}

func (c *BatteryChaincode) Init(stub shim.ChaincodeStubInterface) *pb.Response {
	return shim.Success(nil)
}
func (c *BatteryChaincode) Invoke(stub shim.ChaincodeStubInterface) *pb.Response {
	function, args := stub.GetFunctionAndParameters()
	if len(args) != 1 {
		return shim.Error("INVALID_INPUT: expected one JSON argument")
	}
	identity, err := cid.New(stub)
	if err != nil {
		return shim.Error("UNAUTHENTICATED: certificate required")
	}
	msp, err := identity.GetMSPID()
	if err != nil {
		return shim.Error("UNAUTHENTICATED: MSP missing")
	}
	id, err := identity.GetID()
	if err != nil {
		return shim.Error("UNAUTHENTICATED: identity missing")
	}
	role, found, err := identity.GetAttributeValue("trustguard.role")
	if err != nil || !found {
		return shim.Error("UNAUTHENTICATED: trustguard.role certificate attribute required")
	}
	stamp, err := stub.GetTxTimestamp()
	if err != nil || stamp.CheckValid() != nil {
		return shim.Error("INVALID_TIME: transaction timestamp unavailable")
	}
	certificate, err := identity.GetX509Certificate()
	if err != nil || !certificateTimeValid(certificate, stamp.AsTime()) {
		return shim.Error("UNAUTHENTICATED: enrollment certificate outside validity interval")
	}
	engine := domain.Engine{Store: ledger{stub}, Actor: domain.Actor{MSP: msp, ID: id, Role: role}, Now: stamp.AsTime(), TxID: stub.GetTxID()}
	var result any
	switch function {
	case "Execute":
		result, err = engine.Execute([]byte(args[0]))
	case "Query":
		result, err = engine.Query([]byte(args[0]))
	default:
		return shim.Error("UNKNOWN_FUNCTION: expected Execute or Query")
	}
	if err != nil {
		return shim.Error(err.Error())
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return shim.Error("INTERNAL: serialization failed")
	}
	if function == "Execute" {
		r := result.(domain.Result)
		if r.TxID == stub.GetTxID() {
			if err = stub.SetEvent("BatteryEvent", payload); err != nil {
				return shim.Error("INTERNAL: event failed")
			}
		}
	}
	return shim.Success(payload)
}
func main() {
	if err := shim.Start(&BatteryChaincode{}); err != nil {
		log.Fatal(fmt.Errorf("battery chaincode failed: %w", err))
	}
}
