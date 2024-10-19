// import { v4 as uuidv4 } from "uuid";

// Helper function to get the country based on the user's IP address
const getCountryInfo = async (): Promise<{ ip: string; country: string }> => {
  try {
    const response = await fetch("https://api.country.is/");
    if (!response.ok) {
      throw new Error("Failed to fetch country information");
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(
      "Error fetching country information, defaulting to empty strings:",
      error
    );
    // Return default empty values if the fetch fails
    return { ip: "", country: "" };
  }
};

// Helper function to send data to Firestore
export const trackUserSignup = async (icpPrincipal: string = "") => {
  console.log("Tracking user signup...");
  console.log("ICP Principal:", icpPrincipal);

  const isProd = checkIsProdByURL();
  if (!isProd) return;

  const unixTimestamp = Math.floor(Date.now() / 1000);
  // const id = icpPrincipal || uuidv4(); // Generating a new UUID

  // first track to Google Analytics
  if ((window as any).gtag) {
    console.log("Tracking user signup in Google Analytics...");
    (window as any).gtag("event", "user_signup", {
      event_category: "engagement",
      event_label: "signup",
      icp_principal: icpPrincipal, // Custom field for ICP Principal
      unix_timestamp: unixTimestamp,
      // Other data can be added here if needed
    });
  }

  // then track in Firestore
  console.log("Sending user signup data to Firestore...");
  const firstUrl = window.location.href; // Getting the current page URL
  const userAgent = window.navigator.userAgent; // Getting the user-agent from the browser

  // Fetch country info from the API
  const countryInfo = await getCountryInfo();

  // Construct the data object
  const data = {
    fields: {
      icpPrincipal: { stringValue: icpPrincipal },
      ip: { stringValue: countryInfo.ip },
      country: { stringValue: countryInfo.country },
      firstUrl: { stringValue: firstUrl },
      "user-agent": { stringValue: userAgent },
      timestamp: { integerValue: unixTimestamp },
    },
  };

  // Firestore URL: Adjust with your actual project and collection ID
  const firestoreUrl = `https://firestore.googleapis.com/v1beta1/projects/arbitrage-bot-ea10c/databases/(default)/documents/officex-anon-users`;

  try {
    const response = await fetch(firestoreUrl, {
      method: "POST", // PUT to create a new document
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      throw new Error(
        errorResponse.message || "Failed to send data to Firestore"
      );
    }

    const responseData = await response.json();
    console.log("Document created successfully:", responseData);
  } catch (error) {
    console.error("Error sending data to Firestore:", error);
  }
};

export function checkIsProdByURL(): boolean {
  if (typeof window !== "undefined" && window.location) {
    return window.location.hostname === "drive.officex.app";
  }
  console.error("Window or location is undefined.");
  return false;
}
