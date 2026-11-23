package domain

import (
	"encoding/json"
	"fmt"
)

type MESRecord struct {
	Kind string          `json:"kind"`
	Data json.RawMessage `json:"data"`
}
type MESImport struct {
	Source     string      `json:"source"`
	Simulation bool        `json:"simulation"`
	Records    []MESRecord `json:"records"`
}

type MESImportReceipt struct {
	RequestID    string `json:"requestId"`
	TxID         string `json:"txId"`
	Organization string `json:"organization"`
	Count        uint64 `json:"count"`
	SourceHash   string `json:"sourceHash"`
}

// Each file uses the submitting organization's certificate. All rows share a Fabric write set.
func (e *Engine) importMES(raw []byte, request string) (string, uint64, error) {
	in, err := decode[MESImport](raw)
	if err != nil {
		return "", 0, err
	}
	if !in.Simulation || in.Source != "MES_SIM" || len(in.Records) == 0 || len(in.Records) > 100 {
		return "", 0, fail("INVALID_INPUT", "expected 1 to 100 simulated MES rows")
	}
	for i, row := range in.Records {
		switch row.Kind {
		case "material":
			_, _, err = e.registerMaterial(row.Data)
		case "batch":
			_, _, err = e.registerBatch(row.Data)
		case "product":
			_, _, err = e.registerAsset(row.Data)
		case "supply":
			_, _, err = e.authorizeAssembly(row.Data)
		case "assembly":
			_, _, err = e.assembly(row.Data, fmt.Sprintf("%s-%d", request, i+1))
		default:
			return "", 0, fail("INVALID_INPUT", "unsupported MES row kind")
		}
		if err != nil {
			return "", 0, fmt.Errorf("%w (MES row %d)", err, i+1)
		}
	}
	count := uint64(len(in.Records))
	receipt := MESImportReceipt{request, e.TxID, e.Actor.MSP, count, Digest(in)}
	return request, count, e.put("mes-import:"+e.TxID, receipt)
}
