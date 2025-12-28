from openai import OpenAI
import traceback

# Replace with your actual API key
API_KEY = "sk-pyyW1pClCVlFK3TP7pwOWNVDsutzUGNXp39h7gi7eYAaH8a1"
BASE_URL = "https://api.chatanywhere.tech/v1"

try:
    client = OpenAI(
        api_key=API_KEY,
        base_url=BASE_URL
    )

    # Simple chat completion test
    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "current date and time india"}
        ]
    )

    # Output the full response message
    print("✅ Response received:")
    print(response.choices[0].message.content)

except Exception as e:
    print("❌ Error occurred while testing the API key or endpoint:")
    traceback.print_exc()
