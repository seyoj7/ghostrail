import { handlePlaygroundPost } from "../../../backend/playground";

// Allow the playground proxy to wait for slow or cold-starting endpoints.
export const maxDuration = 120;

export const POST = handlePlaygroundPost;
