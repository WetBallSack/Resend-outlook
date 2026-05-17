import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { Webhook } from "svix";

// Initialize external clients
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://example.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "mock-key";
const supabase = createClient(supabaseUrl, supabaseKey);

const resendApiKey = process.env.RESEND_API_KEY;
const resend = new Resend(resendApiKey || "mock-key");

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Webhook Route needs raw body for Svix signature verification
  // So we define it BEFORE the global express.json()
  app.post("/api/webhooks/incoming", express.raw({ type: 'application/json' }), async (req: Request, res: Response): Promise<void> => {
    try {
      const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
      let payload;

      // If webhook secret is provided, verify it
      if (webhookSecret) {
        const wh = new Webhook(webhookSecret);
        try {
          // Svix requires headers to be properly passed with raw body string
          payload = wh.verify(req.body, req.headers as Record<string, string>);
        } catch (err: any) {
          console.error("Webhook verification failed:", err.message);
          res.status(422).json({ error: "Webhook verification failed", details: err.message });
          return;
        }
      } else {
         // If no secret configured, fallback to parsing manually (Not secure for production)
         payload = JSON.parse(req.body.toString());
      }
      
      // Resend webhook payload structure for "email.received"
      if (payload.type === "email.received" && payload.data) {
         const { from, to, subject, html, text, headers, messageId } = payload.data;
         
         let inReplyTo = null;
         let references = null;
         
         // Parse headers array if provided
         if (headers && Array.isArray(headers)) {
            const replyToHeader = headers.find((h: any) => h.name.toLowerCase() === 'in-reply-to');
            const refHeader = headers.find((h: any) => h.name.toLowerCase() === 'references');
            
            if (replyToHeader) inReplyTo = replyToHeader.value;
            if (refHeader) references = refHeader.value;
         }

         // Determine thread ID
         let threadId = inReplyTo || references || messageId; 

         const toAddress = Array.isArray(to) ? to.join(', ') : to;

         const { error: dbError } = await supabase
          .from('emails')
          .insert({
            thread_id: threadId,
            message_id: messageId,
            in_reply_to: inReplyTo,
            from_address: from,
            to_address: toAddress,
            subject: subject || '(No Subject)',
            html_body: html || '',
            text_body: text || '',
            folder: 'inbox'
          });

         if (dbError) {
          console.error("Webhook DB Save Error:", dbError);
         }
      }

      res.status(200).json({ received: true });
    } catch (e: any) {
      console.error("Webhook error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Use JSON middleware for all other routes
  app.use(express.json());

  // API Route: Send Email
  app.post("/api/emails/send", async (req: Request, res: Response): Promise<void> => {
    try {
      const { fromPrefix, to, subject, htmlBody, replyToMessageId, threadId } = req.body;
      
      if (!fromPrefix || !to || !subject || !htmlBody) {
         res.status(400).json({ error: "Missing required fields" });
         return;
      }

      if (!resendApiKey) {
        throw new Error("RESEND_API_KEY environment variable is required");
      }

      const senderEmail = `${fromPrefix}@auraplot.site`;
      
      // Construct headers for threading
      const headers: any = {};
      if (replyToMessageId) {
        headers['In-Reply-To'] = replyToMessageId;
        headers['References'] = replyToMessageId;
      }

      const { data: sendData, error: sendError } = await resend.emails.send({
        from: senderEmail,
        to,
        subject,
        html: htmlBody,
        headers,
      });

      if (sendError) {
        res.status(500).json({ error: sendError.message });
        return;
      }

      // Generate a new message id for the sent message, Resend doesn't expose it directly until delivered, 
      // but we can generate our own format or rely on resend's id
      const generatedMessageId = `<${sendData?.id}@auraplot.site>`;
      const finalThreadId = threadId || generatedMessageId;

      const { data: dbData, error: dbError } = await supabase
        .from('emails')
        .insert({
          thread_id: finalThreadId,
          message_id: generatedMessageId,
          in_reply_to: replyToMessageId || null,
          from_address: senderEmail,
          to_address: Array.isArray(to) ? to.join(', ') : to,
          subject,
          html_body: htmlBody,
          text_body: htmlBody.replace(/<[^>]*>?/gm, ''), // Rough fallback
          folder: 'sent'
        });

      if (dbError) {
         console.error("DB Error saving sent email:", dbError);
         // Don't fail the request since email sent
      }

      res.status(200).json({ success: true, data: sendData, emailId: generatedMessageId, threadId: finalThreadId });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message || "Internal server error" });
    }
  });

  // API Route: Get threads (for testing locally before frontend supabase config)
  // But standard practice in React with Supabase is to have client query it directly.
  // We'll let the React client do direct queries via VITE_SUPABASE_URL and ANON_KEY to save time,
  // Or we can add an endpoint here. Let's do an endpoint so we don't expose ANON key if we don't want to,
  // but Supabase is meant for client queries. We will use the VITE_ envs on frontend.

  app.get("/api/emails", async (req: Request, res: Response): Promise<void> => {
    try {
      const { data: emails, error } = await supabase
        .from('emails')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      res.status(200).json(emails);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
