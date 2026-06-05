package authz

import (
	"bytes"
	"encoding/base64"
	"image/png"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

// TOTPIssuer is the label shown in authenticator apps.
const TOTPIssuer = "Castor"

// TOTPEnrollment is the data returned when a user starts TOTP enrollment.
type TOTPEnrollment struct {
	Secret      string // base32 secret (shown once for manual entry)
	OTPAuthURL  string // otpauth:// provisioning URI
	QRPNGBase64 string // base64-encoded PNG of the provisioning QR code
}

// GenerateTOTP creates a new TOTP secret for a user and renders its QR code.
func GenerateTOTP(username string) (*TOTPEnrollment, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      TOTPIssuer,
		AccountName: username,
	})
	if err != nil {
		return nil, err
	}
	img, err := key.Image(256, 256)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return &TOTPEnrollment{
		Secret:      key.Secret(),
		OTPAuthURL:  key.URL(),
		QRPNGBase64: base64.StdEncoding.EncodeToString(buf.Bytes()),
	}, nil
}

// ValidateTOTP checks a code against a base32 secret, allowing +/-1 step (30s)
// of clock skew.
func ValidateTOTP(code, secret string) bool {
	ok, err := totp.ValidateCustom(code, secret, nowFunc(), totp.ValidateOpts{
		Period:    30,
		Skew:      1,
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	return err == nil && ok
}
