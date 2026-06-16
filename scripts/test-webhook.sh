#!/usr/bin/env bash
# Razorpay webhook sandbox test — signs a fake payment.captured with your
# RAZORPAY_WEBHOOK_SECRET and posts it TWICE to prove idempotency.
# Usage: ./scripts/test-webhook.sh <razorpayOrderId> <amountPaise> [baseUrl] [secret]
set -euo pipefail
RZP_ORDER_ID="${1:?razorpayOrderId required}"
AMOUNT_PAISE="${2:?amountPaise required}"
BASE="${3:-http://localhost:4000}"
SECRET="${4:-${RAZORPAY_WEBHOOK_SECRET:-change-me}}"
PAYMENT_ID="pay_test_$(openssl rand -hex 6)"
BODY=$(printf '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"%s","order_id":"%s","amount":%s,"method":"upi"}}}}' "$PAYMENT_ID" "$RZP_ORDER_ID" "$AMOUNT_PAISE")
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
echo "payment_id=$PAYMENT_ID"
echo "--- delivery 1:"; curl -s -X POST "$BASE/v1/payments/razorpay/webhook" -H "content-type: application/json" -H "x-razorpay-signature: $SIG" -d "$BODY"; echo
echo "--- delivery 2 (must be duplicate-ignored):"; curl -s -X POST "$BASE/v1/payments/razorpay/webhook" -H "content-type: application/json" -H "x-razorpay-signature: $SIG" -d "$BODY"; echo
echo "--- bad signature (must be 401):"; curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/v1/payments/razorpay/webhook" -H "content-type: application/json" -H "x-razorpay-signature: deadbeef" -d "$BODY"
