// @ts-nocheck
export async function POST(req: Request) {
    // Flaw: Reading Paystack event directly without HMAC SHA-512 check
    const body = await req.json();
    const event = body.event;

    if (event === 'charge.success') {
        // Fulfill order
    }

    return new Response('OK', { status: 200 });
}