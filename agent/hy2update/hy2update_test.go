package hy2update

import "testing"

func TestNormalizeVersionFromHysteriaVersionOutput(t *testing.T) {
	raw := `
░█░█░█░█░█▀▀░▀█▀░█▀▀░█▀▄░▀█▀░█▀█░░░▀▀▄
░█▀█░░█░░▀▀█░░█░░█▀▀░█▀▄░░█░░█▀█░░░▄▀░
░▀░▀░░▀░░▀▀▀░░▀░░▀▀▀░▀░▀░▀▀▀░▀░▀░░░▀▀▀

a powerful, lightning fast and censorship resistant proxy
Aperture Internet Laboratory <https://github.com/apernet>

Version:        v2.9.1
BuildDate:      2026-05-10T17:31:40Z
BuildType:      release
Toolchain:      go1.26.3 linux/amd64
CommitHash:     64c396385631579598cc29d5561bff98c439772f
Platform:       linux
Architecture:   amd64
Libraries:      quic-go=v0.59.1-0.20260425001925-6c6cc9bcb716
`

	if got := NormalizeVersion(raw); got != "2.9.1" {
		t.Fatalf("NormalizeVersion() = %q, want %q", got, "2.9.1")
	}
}

func TestNormalizeVersionAcceptsReleaseTags(t *testing.T) {
	cases := map[string]string{
		"v2.9.1":         "2.9.1",
		"2.9.1":          "2.9.1",
		"app/v2.9.1":     "2.9.1",
		"v2.10.0-beta.1": "2.10.0-beta.1",
	}

	for raw, want := range cases {
		if got := NormalizeVersion(raw); got != want {
			t.Fatalf("NormalizeVersion(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestNormalizeVersionDoesNotGuessFromOtherMetadata(t *testing.T) {
	raw := `BuildDate:      2026-05-10T17:31:40Z
Toolchain:      go1.26.3 linux/amd64
Libraries:      quic-go=v0.59.1-0.20260425001925-6c6cc9bcb716`

	if got := NormalizeVersion(raw); got != "" {
		t.Fatalf("NormalizeVersion() = %q, want empty string", got)
	}
}
