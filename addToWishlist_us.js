const AWS = require("aws-sdk");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const dynamodb = new AWS.DynamoDB.DocumentClient();

const WISHLIST_TABLE = process.env.WISHLIST_TABLE;
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE;
const JWT_SECRET = process.env.JWT_SECRET;

/* ---------- RESPONSE HELPER ---------- */
const response = (statusCode, body = {}) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
  },
  body: JSON.stringify(body)
});

/* ---------- MAIN HANDLER ---------- */
exports.handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method;

  if (method === "OPTIONS") return response(200);

  try {
    /* ---------- AUTH ---------- */
    const authHeader =
      event.headers?.authorization || event.headers?.Authorization;

    if (!authHeader) {
      return response(401, { message: "Authorization header missing" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userEmail = decoded.email;

    /* =====================================================
       📥 GET WISHLIST
       ===================================================== */
    if (method === "GET") {
      let items = [];
      let lastKey;

      do {
        const data = await dynamodb.query({
          TableName: WISHLIST_TABLE,
          KeyConditionExpression: "userEmail = :u",
          ExpressionAttributeValues: {
            ":u": userEmail
          },
          ExclusiveStartKey: lastKey
        }).promise();

        items.push(...data.Items);
        lastKey = data.LastEvaluatedKey;
      } while (lastKey);

      return response(200, { items });
    }

    /* ---------- BODY REQUIRED ---------- */
    const body = JSON.parse(event.body || "{}");
    if (!body.productId) {
      return response(400, { message: "productId required" });
    }

    const wishlistId = body.productId.toUpperCase(); // SAME AS SORT KEY

    /* =====================================================
       ➕ ADD TO WISHLIST
       ===================================================== */
    if (method === "POST") {
      const productResult = await dynamodb.get({
        TableName: PRODUCTS_TABLE,
        Key: { productId: wishlistId }
      }).promise();

      if (!productResult.Item) {
        return response(404, { message: "Product not found" });
      }

      const product = productResult.Item;

      await dynamodb.put({
        TableName: WISHLIST_TABLE,
        Item: {
          userEmail,
          wishlistId,          // SORT KEY
          productId: wishlistId,
          productName: product.productName,
          price: product.price,
          addedAt: new Date().toISOString()
        },
        ConditionExpression: "attribute_not_exists(userEmail) AND attribute_not_exists(wishlistId)"
      }).promise();

      await saveNotification(userEmail, `❤️ Added ${product.productName} to wishlist`);

      return response(200, { message: "Added to wishlist" });
    }

    /* =====================================================
       ❌ REMOVE FROM WISHLIST
       ===================================================== */
    if (method === "DELETE") {
      await dynamodb.delete({
        TableName: WISHLIST_TABLE,
        Key: {
          userEmail,
          wishlistId           // MUST MATCH SORT KEY NAME
        }
      }).promise();

      await saveNotification(userEmail, `❌ Removed ${product.productName} from wishlist`);

      return response(200, { message: "Removed from wishlist" });
    }

    return response(405, { message: "Method not allowed" });

  } catch (err) {
    console.error("WISHLIST ERROR:", err);

    if (err.code === "ConditionalCheckFailedException") {
      return response(200, { message: "Item already in wishlist" });
    }

    return response(500, { message: err.message });
  }
};

/* =====================================================
   🔔 SAVE NOTIFICATION
   ===================================================== */
const saveNotification = async (userEmail, message) => {
  await dynamodb.put({
    TableName: NOTIFICATIONS_TABLE,
    Item: {
      notificationId: uuidv4(),
      userEmail,
      message,
      isRead: false,
      createdAt: new Date().toISOString()
    }
  }).promise();
};
