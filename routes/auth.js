const express = require('express');
const axios = require('axios');
const Page = require('../models/Page');
const router = express.Router();

router.get('/facebook', (req, res) => {
    const redirect_uri = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${process.env.FB_REDIRECT_URI}&scope=pages_messaging,pages_manage_posts,pages_read_engagement,pages_manage_metadata,pages_read_user_content&response_type=code`;
    res.redirect(redirect_uri);
});

router.get('/facebook/callback', async (req, res) => {
    const code = req.query.code;
    try {
        const { data: tokenData } = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
            params: {
                client_id: process.env.FB_APP_ID,
                client_secret: process.env.FB_APP_SECRET,
                redirect_uri: process.env.FB_REDIRECT_URI,
                code
            }
        });

        const { data: me } = await axios.get(`https://graph.facebook.com/me?access_token=${tokenData.access_token}`);
        const { data: pages } = await axios.get(`https://graph.facebook.com/me/accounts?access_token=${tokenData.access_token}`);

        for (const page of pages.data) {
            await Page.updateOne(
                { pageId: page.id },
                {
                    userId: me.id,
                    pageId: page.id,
                    name: page.name,
                    access_token: page.access_token,
                    connected_at: new Date()
                },
                { upsert: true }
            );
        }

        res.json({ user: me, pages: pages.data });
    } catch (err) {
        console.error('❌ Facebook login error:', err);
        res.status(500).json({ error: 'Facebook login failed' });
    }
});

module.exports = router;