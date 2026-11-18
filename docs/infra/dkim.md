# DKIM on mail.mojomo.io — findings, 18 Nov 2026

## Status: WORKING

DKIM signs and verifies correctly. The earlier "body hash mismatch" was a
false alarm caused by the test receiver, not by our configuration.

## Evidence

A message sent through Postfix and delivered locally verifies cleanly:

    dkim.verify(raw_local_message) -> True

The same message, read back from mail.tm, fails. The difference is that
mail.tm's Haraka MTA inserts an extra CRLF before the body on receipt:

    sent:     ...Message-Id: <x@mail.mojomo.io>\r\n\r\nbody
    received: ...Message-Id: <x@mail.mojomo.io>\r\n\r\n\r\nbody

That extra blank line changes the body hash, so the signature fails at that
receiver only. Our outbound message is correct.

## Configuration (verified)

- Postfix 3.10.6, opendkim running, Mode sv
- KeyTable: mojomo.io -> /etc/postfix/dkim/default.key
- SigningTable: *@mojomo.io -> default._domainkey.mojomo.io
- Canonicalization: relaxed/relaxed
- DNS TXT default._domainkey.mojomo.io matches the signing key byte-for-byte
  (392-byte DER public key, compared programmatically)
- SPF: v=spf1 mx a ip4:185.132.38.167 ~all — sending IP matches
- DMARC: p=quarantine, rua=house@house.mojomo.io
- PTR: 185.132.38.167 -> mail.mojomo.io
- HELO now set to mail.mojomo.io to match the PTR

## Changes made

- smtp_helo_name = mail.mojomo.io (was defaulting to the hostname "ubuntu")
- Removed unused params: smtp_diagnostics, milter_fail_action
- Backup of original config: /etc/postfix/main.cf.bak.dkimfix

## Caveat

mail.tm is not a reliable DKIM verifier — it mangles bodies. Do not use it to
judge deliverability. Use a real mailbox you control, or a service like
mail-tester.com that reports the actual Authentication-Results header.

## Not yet confirmed

Whether mail lands in inbox or spam at Gmail/Google Workspace. DKIM passing
is necessary but not sufficient — domain reputation matters and mojomo.io has
little sending history. The only way to know is to send to a real mailbox and
look.
