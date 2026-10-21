# DNS records to add — house.mojomo.io

Add these at your DNS provider. `mojomo.io` itself is untouched.

---

## 1. DKIM (required)

| Field | Value |
|---|---|
| Type | `TXT` |
| Name / Host | `default._domainkey.house` |
| TTL | `3600` |
| Value | see below |

```
v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtJy3bExWa209JbiDfhdGpblXGhWYUuyVBEuT6coJnIxV3h6aJSiLDsZIV+zvBMXbuMJdBr2+T/KTF9X7RcScwgTkeVJtIJazD6tC2KW0Yb7sKNNZd/AIgNqg1rvOJ9LmuMqusg0pp0BzyOas82+xsdJk5ijV69tz2gE5i6SJ8za/+9s3LEKOcqisLVWmT2TTAkNV38hRY+UNPexwNyNQWIgg2D34ENU9RRD8WvsBH3W2TNsozqjPV+JzVsSCJ/c5FSVY/qJYhMPqPQW+PiNMTmkhIGv4i3Fx75zggXnGIURz/FIoZ3UQga1e3WlnRth1NDAJqbVyaBbFFuINe86aJwIDAQAB
```

**Important:** some providers auto-split long TXT values into quoted chunks. That's fine — the chunks must concatenate to the string above with **no spaces inside `p=`**. A space inside the key breaks DKIM silently. (This is exactly what's wrong with the existing `default._domainkey.mojomo.io` record — 19 embedded spaces, never worked.)

---

## 2. SPF (required)

| Field | Value |
|---|---|
| Type | `TXT` |
| Name / Host | `house` |
| TTL | `3600` |
| Value | `v=spf1 ip4:185.132.38.167 -all` |

`-all` is safe: this subdomain sends only from this box.

---

## 3. DMARC (recommended)

| Field | Value |
|---|---|
| Type | `TXT` |
| Name / Host | `_dmarc.house` |
| TTL | `3600` |
| Value | `v=DMARC1; p=quarantine; rua=mailto:avatar@mojomo.io; adkim=s; aspf=s` |

Start at `p=quarantine`; move to `p=reject` after a week of clean reports.

---

## 4. Optional — MX (only if you want inbound to house@house.mojomo.io)

| Field | Value |
|---|---|
| Type | `MX` |
| Name / Host | `house` |
| Priority | `10` |
| Value | `mail.mojomo.io` |

Skip unless you want replies to land on this box. Note `mail.mojomo.io` does not currently resolve — you'd need an A record for it first.

---

## After you add them

Tell me and I'll:
1. Verify all three with `dig` (checking for spaces in `p=`)
2. Switch OpenDKIM to sign as `house.mojomo.io`
3. Set `MAIL_FROM=no-reply@house.mojomo.io`
4. Send a live test and confirm Gmail reports `dkim=pass` and `spf=pass`

---

## Current state

OpenDKIM is signing as `mojomo.io` right now so mail keeps flowing. Signing as `house.mojomo.io` before its DNS exists causes Gmail to hard-bounce (`550-5.7.26`) — I tested this and confirmed it. The switch is a two-line config change, ready to flip.
