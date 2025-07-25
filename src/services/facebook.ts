import axios from "axios";
import Redis from "ioredis";

interface BatchRequest {
    method: string;
    relative_url: string;
}

interface FacebookUser {
    id: string;
    name: string;
    picture?: { data: { url: string } };
}

interface FacebookPage {
    id: string;
    name: string;
    access_token: string;
}

/**
 * Execute batch requests to Facebook Graph API
 * @param requests - Array of batch requests
 * @param accessToken - Facebook access token
 * @returns Array of responses
 */
export async function batchRequest(requests: BatchRequest[], accessToken: string): Promise<any[]> {
    try {
        const response = await axios.post(
            "https://graph.facebook.com/v23.0/",
            { batch: requests },
            { params: { access_token: accessToken } }
        );
        return response.data;
    } catch (error: any) {
        throw new Error(`Batch request failed: ${error.message}`);
    }
}

/**
 * Get Facebook user information
 * @param userId - Facebook user ID
 * @param accessToken - Facebook access token
 * @param redis - Redis client
 * @returns User information
 */
export async function getFacebookUser(userId: string, accessToken: string, redis: Redis): Promise<FacebookUser | null> {
    const cacheKey = `fb_user:${userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
        const { data } = await axios.get(
            `https://graph.facebook.com/v23.0/${userId}?fields=id,name,picture&access_token=${accessToken}`
        );
        await redis.setex(cacheKey, 3600, JSON.stringify(data)); // Cache for 1 hour
        return data;
    } catch (error: any) {
        return null;
    }
}

/**
 * Get Facebook pages managed by the user
 * @param accessToken - Facebook user access token
 * @param redis - Redis client
 * @returns Array of pages
 */
export async function getFacebookPages(accessToken: string, redis: Redis): Promise<FacebookPage[]> {
    const cacheKey = `fb_pages:${accessToken.slice(0, 10)}`; // Partial token for cache key
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
        const { data } = await axios.get(
            `https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token&access_token=${accessToken}`
        );
        if (!Array.isArray(data.data)) {
            throw new Error("Invalid pages data from Facebook");
        }
        await redis.setex(cacheKey, 3600, JSON.stringify(data.data)); // Cache for 1 hour
        return data.data;
    } catch (error: any) {
        throw new Error(`Failed to fetch pages: ${error.message}`);
    }
}

/**
 * Refresh Facebook page access token
 * @param pageId - Facebook page ID
 * @returns Updated page data
 */
export async function refreshAccessToken(pageId: string): Promise<any> {
    // Placeholder: Implement token refresh logic using FB App ID and Secret
    throw new Error("Refresh token not implemented");
}