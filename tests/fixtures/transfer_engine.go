// Test-only transport for the browser fixture. No Fabric gateway or external storage.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"trustguard/battery/domain"
)

type memoryStore map[string][]byte

func (s memoryStore) Get(k string) ([]byte, error) { return s[k], nil }
func (s memoryStore) Put(k string, v []byte) error { s[k] = v; return nil }
func (s memoryStore) Scan(prefix string) ([][]byte, error) {
	var keys []string
	for k := range s {
		if strings.HasPrefix(k, prefix) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var rows [][]byte
	for _, k := range keys {
		rows = append(rows, s[k])
	}
	return rows, nil
}

type request struct {
	Op      string
	Actor   domain.Actor
	Command json.RawMessage
	Query   json.RawMessage
}

func handle(store memoryStore, in request, sequence int) (any, error) {
	engine := domain.Engine{Store: store, Actor: in.Actor, Now: time.Now().UTC(), TxID: fmt.Sprintf("memory-%d", sequence)}
	switch in.Op {
	case "execute":
		return engine.Execute(in.Command)
	case "query":
		return engine.Query(in.Query)
	case "packs", "transfers":
		prefix := "asset:"
		if in.Op == "transfers" {
			prefix = "transfer:"
		}
		rows, _ := store.Scan(prefix)
		result := make([]json.RawMessage, 0, len(rows))
		for _, row := range rows {
			result = append(result, json.RawMessage(row))
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unknown fixture operation")
	}
}

func main() {
	store := memoryStore{}
	pack := domain.Asset{ID: "fixture-pack", Code: "DEMPB010000001E119876543", Type: "PACK", HolderMSP: domain.PackOrg,
		MakerMSP: domain.PackOrg, State: "ASSEMBLED", Version: 7, Quality: "QC_PASSED", Simulation: true, Children: []string{}}
	store["asset:"+pack.ID], _ = json.Marshal(pack)
	input := bufio.NewScanner(os.Stdin)
	output := json.NewEncoder(os.Stdout)
	for seq := 1; input.Scan(); seq++ {
		var in request
		if err := json.Unmarshal(input.Bytes(), &in); err != nil {
			panic(err)
		}
		value, err := handle(store, in, seq)
		if err != nil {
			_ = output.Encode(map[string]string{"error": err.Error()})
		} else {
			_ = output.Encode(map[string]any{"value": value})
		}
	}
}
