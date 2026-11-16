package domain

import "encoding/json"

type HistoryRecord struct {
	TxID    string          `json:"txId"`
	At      string          `json:"at"`
	Deleted bool            `json:"deleted"`
	Value   json.RawMessage `json:"value"`
}
type HistoryStore interface {
	History(string) ([]HistoryRecord, error)
}
type Ancestry struct {
	Asset     Asset   `json:"asset"`
	Ancestors []Asset `json:"ancestors"`
}

func (e *Engine) ancestry(id string) (Ancestry, error) {
	a, err := e.asset(id)
	if err != nil {
		return Ancestry{}, err
	}
	out := Ancestry{Asset: a, Ancestors: []Asset{}}
	for depth := 0; a.ParentID != ""; depth++ {
		if depth >= 2 {
			return Ancestry{}, fail("CORRUPT_LINEAGE", "invalid parent depth")
		}
		parent, er := e.asset(a.ParentID)
		if er != nil {
			return Ancestry{}, er
		}
		if !contains(parent.Children, a.ID) || a.Type == "CELL" && parent.Type != "MODULE" || a.Type == "MODULE" && parent.Type != "PACK" || a.Type == "PACK" {
			return Ancestry{}, fail("CORRUPT_LINEAGE", "parent relation mismatch")
		}
		out.Ancestors = append(out.Ancestors, parent)
		a = parent
	}
	return out, nil
}
