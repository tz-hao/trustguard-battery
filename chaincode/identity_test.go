package main

import (
	"crypto/x509"
	"testing"
	"time"
)

func TestEnrollmentCertificateValidityIsEnforced(t *testing.T) {
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	cert := &x509.Certificate{NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour)}
	if !certificateTimeValid(cert, now) {
		t.Fatal("valid enrollment certificate rejected")
	}
	if certificateTimeValid(cert, now.Add(2*time.Hour)) {
		t.Fatal("expired enrollment certificate accepted")
	}
	if certificateTimeValid(cert, now.Add(-2*time.Hour)) {
		t.Fatal("future enrollment certificate accepted")
	}
}
