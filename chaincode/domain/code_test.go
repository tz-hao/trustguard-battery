package domain

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"testing/quick"
	"time"
)

func TestStandardCodeExamplesAndScope(t *testing.T) {
	// Appendix A.1, PDF page 10 (printed page 6).
	p, err := ParseCode("101PE052011A117AA0000100")
	if err != nil || p.ProductType != "PACK" || p.Chemistry != "TERNARY" || p.SpecCode != "05" || p.TraceCode != "2011A11" || p.Serial != "0000100" {
		t.Fatal(p, err)
	}
	if p.ProductionDateCode != (ProductionDateCode{"7", 2017, 30, 10, 10, true}) || p.Validation != "CODE_FIELDS_VERIFIED" || p.StandardVersion != CodeStandardAmended || p.CodeScope != "NEW_PRODUCT_24" || p.StandardSourceHash != CodeStandardPDFHash {
		t.Fatal("incorrect scope or inferred unique production year", p)
	}
	if err := ValidateCodeManufactureDate(p.Code, "2017-10-10"); err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"", "101PE052011A117AA000010", "101PE052011A117AA00001000", "SIMCB010000001GB1000000!", "SIMXB010000001GB10000001", "SIMCI010000001GB10000001", "201MC038800002000RM"} {
		if _, err := ParseCode(code); err == nil {
			t.Fatalf("accepted code outside interface/standard %q", code)
		}
	}
}

func TestAmendedMaterialDictionary(t *testing.T) {
	for _, entry := range []struct{ code, chemistry, name string }{
		{"A", "NIMH", "镍氢电池"}, {"B", "LFP", "磷酸铁锂电池"}, {"C", "LMO", "锰酸锂电池"},
		{"D", "LCO", "钴酸锂电池"}, {"E", "TERNARY", "三元材料电池"}, {"F", "SUPERCAPACITOR", "超级电容器"},
		{"G", "LTO", "钛酸锂电池"}, {"H", "LMFP", "磷酸锰铁锂电池"}, {"J", "SODIUM_ION", "钠离子电池"}, {"Z", "OTHER", "其他"},
	} {
		p, err := ParseCode("SIMC" + entry.code + "01" + "I0QSZ00" + "G81" + "A00000Z")
		if err != nil || p.Chemistry != entry.chemistry || p.BatteryTypeName != entry.name || p.BatteryTypeCode != entry.code || p.AdditionalSpecCodeCandidate != "I" || p.TraceCode != "I0QSZ00" {
			t.Fatal(entry, p, err)
		}
		// Discouraged ambiguous trace letters are an advisory, not a prohibition.
	}
}

func TestStandardDateTableAndCycle(t *testing.T) {
	// Independent transcription of Table 4 and Table 5, PDF pages 7 and 8.
	for _, row := range []struct{ date, code string }{
		{"2011-01-01", "111"}, {"2020-10-10", "AAA"}, {"2021-11-11", "BBB"}, {"2022-12-12", "CCC"},
		{"2026-01-01", "G11"}, {"2027-01-01", "H11"}, {"2028-02-29", "J2X"},
		{"2031-01-01", "M11"}, {"2032-01-01", "N11"}, {"2033-01-01", "P11"},
		{"2034-01-01", "R11"}, {"2035-01-01", "S11"}, {"2036-01-01", "T11"},
		{"2037-01-01", "V11"}, {"2038-01-01", "W11"}, {"2039-01-01", "X11"}, {"2040-12-31", "YC0"},
		{"2041-01-01", "111"}, {"2050-08-31", "A80"}, {"2100-03-01", "Y31"},
	} {
		encoded, err := EncodeProductionDate(row.date)
		if err != nil || encoded != row.code {
			t.Fatal(row, encoded, err)
		}
	}
	for day, expected := range []byte("123456789ABCDEFGHJKLMNPRSTVWXY0") {
		code, err := EncodeProductionDate(fmt.Sprintf("2026-01-%02d", day+1))
		if err != nil || code != "G1"+string(expected) {
			t.Fatal(day, expected, code, err)
		}
	}
	// GB1 can be 2026-11-01 or 2056-11-01; parsing must keep that ambiguity.
	for _, date := range []string{"2026-11-01", "2056-11-01"} {
		if err := ValidateCodeManufactureDate("SIMCB010000001GB10000001", date); err != nil {
			t.Fatal(date, err)
		}
	}
	for _, code := range []string{"G01", "GD1", "G40", "G2Y", "G2A", "K2X", "I11", "011", "G1I", "G1O", "G1Q", "G1U", "G1Z"} {
		_, err := ParseCode("SIMCB010000001" + code + "0000001")
		// February 10 is valid; all other listed cases are invalid.
		if code == "G2A" {
			if err != nil {
				t.Fatal(err)
			}
		} else if err == nil || !strings.HasPrefix(err.Error(), "CODE_DATE:") {
			t.Fatal("accepted invalid date", code, err)
		}
	}
	// A date's leap validity requires the source year, not only the cyclic code.
	if _, err := ParseCode("SIMCB010000001J2X0000001"); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseCode("SIMCB010000001G2X0000001"); err != nil {
		t.Fatal("2056 leap day must remain possible for year code G", err)
	}
	for _, date := range []string{"2010-01-01", "2026-02-29", "2100-02-29", "2026-04-31", "2026-1-1"} {
		if _, err := EncodeProductionDate(date); err == nil {
			t.Fatal("accepted invalid source date", date)
		}
	}
}

func TestCodeAmendmentEffectiveDate(t *testing.T) {
	for _, row := range []struct{ code, date, errorCode string }{
		{"SIMCH010000001G7YA000001", "2026-07-30", "CODE_CHEMISTRY"},
		{"SIMCB010000001G70A000001", "2026-07-31", "CODE_SERIAL"},
		{"SIMCH010000001G81A000001", "2026-08-01", ""},
		{"SIMCJ010000001G81A000001", "2026-08-01", ""},
		{"SIMCZ010000001G81Z000001", "2026-08-01", ""},
		{"SIMCB010000001G110000001", "2026-01-02", "CODE_DATE_MISMATCH"},
	} {
		err := ValidateCodeManufactureDate(row.code, row.date)
		if row.errorCode == "" && err != nil || row.errorCode != "" && (err == nil || !strings.HasPrefix(err.Error(), row.errorCode+":")) {
			t.Fatal(row, err)
		}
	}
	p, err := parseCode("SIMCB010000001G110000001", false)
	if err != nil || p.StandardVersion != CodeStandardOriginal || p.AdditionalSpecCodeCandidate != "" {
		t.Fatal(p, err)
	}
}

func TestRegistrationRejectsDateMismatchWithoutWrites(t *testing.T) {
	f := newFixture(t)
	f.reject(CellOrg, "manufacturer", "RegisterAsset", RegisterAssetInput{ID: "date-mismatch", Code: "SIMCB010000001GB10000001", BatchID: "batch1", Model: "simulation-model", ManufacturedAt: "2026-01-01", ManufactureSourceHash: Digest("manufacture")}, "CODE_DATE_MISMATCH")
	f.reject(CellOrg, "admin", "RegisterMaker", Maker{"BAD", "Not verified", CellOrg, false, Digest("source")}, "INVALID_MAKER")
	f.add("legacy", "CELL", CellOrg)
	a, _ := f.engine.asset("legacy")
	// Simulate a previously committed provisional record with invalid date fields.
	legacyCode := "SIMCB0100000010000000001"
	a.Code = legacyCode
	f.store["asset:legacy"], _ = json.Marshal(a)
	f.store["code:"+legacyCode], _ = json.Marshal(a.ID)
	if _, err := f.engine.Query([]byte(`{"kind":"battery","id":"` + legacyCode + `"}`)); err != nil {
		t.Fatal("historical provisional record became inaccessible", err)
	}
}

func TestParserFieldsPreserveOriginalCode(t *testing.T) {
	property := func(maker [3]byte, spec [2]byte, trace [7]byte, serial [7]byte, kind, chem uint8, dayOffset uint16) bool {
		chars := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
		field := func(v []byte) string {
			s := make([]byte, len(v))
			for i, b := range v {
				s[i] = chars[int(b)%len(chars)]
			}
			return string(s)
		}
		date := time.Date(2011, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, int(dayOffset))
		encoded, err := EncodeProductionDate(date.Format("2006-01-02"))
		if err != nil {
			return false
		}
		code := field(maker[:]) + string("CMP"[kind%3]) + string("ABCDEFGHJZ"[chem%10]) + field(spec[:]) + field(trace[:]) + encoded + field(serial[:])
		p, err := ParseCode(code)
		return err == nil && p.MakerCode+code[3:5]+p.SpecCode+p.TraceCode+p.DateCode+p.Serial == code && len(p.Code) == 24 && p.Validation == "CODE_FIELDS_VERIFIED" && p.ProductionDateCode.Month == int(date.Month()) && p.ProductionDateCode.Day == date.Day() && (date.Year()-p.ProductionDateCode.CycleFirstYear)%30 == 0 && p.ProductionDateCode.RequiresSourceDate
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 1000}); err != nil {
		t.Fatal(err)
	}
}
