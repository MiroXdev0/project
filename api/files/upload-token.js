import handleVercelApiRequest from "../../src/serverless/api.js";

export const config = {
    api: {
        bodyParser: false
    }
};

export default handleVercelApiRequest;
