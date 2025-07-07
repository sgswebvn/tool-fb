import axios from "axios";
import Page from "../models/Page";

interface FacebookUser {
    id: string;
    name: string;
}

interface FacebookPage {
    id: string;
    name: string;
    access_token: string;
}

export async function getFacebookUser(accessToken: string): Promise<FacebookUser> {
    try {
        const { data } = await axios.get<FacebookUser>(`https://graph.facebook.com/me?access_token=${accessToken}`);
        return data;
    } catch (error) {
        throw new Error("Không thể lấy thông tin người dùng Facebook");
    }
}

export async function getFacebookPages(accessToken: string): Promise<FacebookPage[]> {
    try {
        const { data } = await axios.get<{ data: FacebookPage[] }>(`https://graph.facebook.com/me/accounts?access_token=${accessToken}`);
        return data.data;
    } catch (error) {
        throw new Error("Không thể lấy danh sách trang Facebook");
    }
}
export async function refreshAccessToken(pageId: string) {
    const page = await Page.findOne({ pageId });
    if (!page) throw new Error("Không tìm thấy page");
    const { data } = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
        params: {
            grant_type: "fb_exchange_token",
            client_id: process.env.FB_APP_ID,
            client_secret: process.env.FB_APP_SECRET,
            fb_exchange_token: page.access_token,
        },
    });
    page.access_token = data.access_token;
    page.expires_in = data.expires_in;
    page.connected_at = new Date();
    await page.save();
    return page;
}