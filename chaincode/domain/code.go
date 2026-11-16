package domain

import (
	"strings"
	"time"
)

const (
	CodeStandardOriginal = "GB/T 34014-2017"
	CodeStandardAmended  = "GB/T 34014-2017+A1:2026"
	CodeStandardPDFHash  = "dfc7df9019e3aef3d4d2c86b1443df1ab4592d1e2b3e81c20202c3c406d9426b"
	yearCodes            = "123456789ABCDEFGHJKLMNPRSTVWXY"
	monthCodes           = "123456789ABC"
	dayCodes             = "123456789ABCDEFGHJKLMNPRSTVWXY0"
)

type ProductionDateCode struct {
	YearCode           string `json:"yearCode"`
	CycleFirstYear     int    `json:"cycleFirstYear"`
	YearCycle          int    `json:"yearCycle"`
	Month              int    `json:"month"`
	Day                int    `json:"day"`
	RequiresSourceDate bool   `json:"requiresSourceDate"`
}

type ParsedCode struct {
	Code                        string             `json:"code"`
	MakerCode                   string             `json:"makerCode"`
	ProductType                 string             `json:"productType"`
	Chemistry                   string             `json:"chemistry"`
	SpecCode                    string             `json:"specCode"`
	TraceCode                   string             `json:"traceCode"`
	DateCode                    string             `json:"dateCode"`
	Serial                      string             `json:"serial"`
	Validation                  string             `json:"validation"`
	StandardVersion             string             `json:"standardVersion"`
	StandardSourceHash          string             `json:"standardSourceHash"`
	CodeScope                   string             `json:"codeScope"`
	BatteryTypeCode             string             `json:"batteryTypeCode"`
	BatteryTypeName             string             `json:"batteryTypeName"`
	ProductionDateCode          ProductionDateCode `json:"productionDateCode"`
	AdditionalSpecCodeCandidate string             `json:"additionalSpecCodeCandidate,omitempty"`
}

// ParseCode verifies the project's 24-character new-product fields against the
// current amendment. It does not certify maker allocation, enterprise filings,
// physical markings, or select a year from a repeating 30-year date code.
func ParseCode(code string) (ParsedCode, error) {
	return parseCode(code, true)
}

func parseCode(code string, amended bool) (ParsedCode, error) {
	var p ParsedCode
	if !codePattern.MatchString(code) {
		return p, fail("CODE_FORMAT", "expected 24 uppercase ASCII letters or digits for a new product; echelon codes are outside this interface")
	}
	types := map[byte]string{'C': "CELL", 'M': "MODULE", 'P': "PACK"}
	chemistries := map[byte][2]string{
		'A': {"NIMH", "镍氢电池"}, 'B': {"LFP", "磷酸铁锂电池"},
		'C': {"LMO", "锰酸锂电池"}, 'D': {"LCO", "钴酸锂电池"},
		'E': {"TERNARY", "三元材料电池"}, 'F': {"SUPERCAPACITOR", "超级电容器"},
		'G': {"LTO", "钛酸锂电池"}, 'Z': {"OTHER", "其他"},
	}
	version := CodeStandardOriginal
	if amended {
		chemistries['H'] = [2]string{"LMFP", "磷酸锰铁锂电池"}
		chemistries['J'] = [2]string{"SODIUM_ION", "钠离子电池"}
		version = CodeStandardAmended
	}
	if types[code[3]] == "" {
		return p, fail("CODE_PRODUCT", "invalid product type at position 4")
	}
	chemistry, ok := chemistries[code[4]]
	if !ok {
		return p, fail("CODE_CHEMISTRY", "battery type is not defined by the applicable standard edition")
	}
	if !amended {
		for _, c := range code[17:] {
			if c < '0' || c > '9' {
				return p, fail("CODE_SERIAL", "original edition requires seven decimal serial digits")
			}
		}
	}
	yearIndex := strings.IndexByte(yearCodes, code[14])
	month := strings.IndexByte(monthCodes, code[15]) + 1
	day := strings.IndexByte(dayCodes, code[16]) + 1
	if yearIndex < 0 || month == 0 || day == 0 {
		return p, fail("CODE_DATE", "invalid year, month or day code")
	}
	// Check both first cycles (2011..2070). Even year codes can alternate
	// leap validity after 30 years; odd year codes can never denote February 29.
	possible := false
	for _, year := range []int{2011 + yearIndex, 2041 + yearIndex} {
		calendar := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
		possible = possible || int(calendar.Month()) == month && calendar.Day() == day
	}
	if !possible {
		return p, fail("CODE_DATE", "impossible calendar month and day")
	}
	p = ParsedCode{
		Code: code, MakerCode: code[:3], ProductType: types[code[3]], Chemistry: chemistry[0],
		SpecCode: code[5:7], TraceCode: code[7:14], DateCode: code[14:17], Serial: code[17:],
		Validation: "CODE_FIELDS_VERIFIED", StandardVersion: version, StandardSourceHash: CodeStandardPDFHash,
		CodeScope: "NEW_PRODUCT_24", BatteryTypeCode: code[4:5], BatteryTypeName: chemistry[1],
		ProductionDateCode: ProductionDateCode{code[14:15], 2011 + yearIndex, 30, month, day, true},
	}
	if amended {
		// X8 is only a candidate. The enterprise's filing determines whether it
		// is an additional specification digit; keep all seven trace digits intact.
		p.AdditionalSpecCodeCandidate = code[7:8]
	}
	return p, nil
}

// EncodeProductionDate encodes a source-provided Gregorian date. It never
// reconstructs a unique Gregorian year from a three-character date code.
func EncodeProductionDate(date string) (string, error) {
	d, err := time.Parse("2006-01-02", date)
	if err != nil || d.Year() < 2011 {
		return "", fail("INVALID_DATE", "expected a Gregorian date from 2011 onward")
	}
	return string([]byte{yearCodes[(d.Year()-2011)%30], monthCodes[int(d.Month())-1], dayCodes[d.Day()-1]}), nil
}

func ValidateCodeManufactureDate(code, date string) error {
	encoded, err := EncodeProductionDate(date)
	if err != nil {
		return err
	}
	// Select the applicable edition using the evidenced production date, not
	// the server clock; amended serials/materials do not apply retroactively.
	p, err := parseCode(code, date >= "2026-08-01")
	if err != nil {
		return err
	}
	if p.DateCode != encoded {
		return fail("CODE_DATE_MISMATCH", "code date does not match the source-provided manufacturing date")
	}
	return nil
}
