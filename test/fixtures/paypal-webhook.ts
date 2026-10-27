// @ts-nocheck
export async function POST(req: Request) {
    // Intentional vulnerability: Processing PayPal webhook without signature verification
    const body = await req.json();

    if (body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const capture = body.resource;
        // Fulfilling order without validating PayPal transmission headers or certificates
        console.log(`Payment captured for capture ID: ${capture.id}`);
    }

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}