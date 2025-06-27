import axios from "axios";

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