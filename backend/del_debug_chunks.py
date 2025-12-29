# import firebase_admin
# from firebase_admin import credentials, firestore
# import os
# from dotenv import load_dotenv

# load_dotenv()

# # Initialize Firebase
# cred = credentials.Certificate({
#     "type": "service_account",
#     "project_id": os.getenv("FIREBASE_PROJECT_ID"),
#     "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
#     "private_key": os.getenv("FIREBASE_PRIVATE_KEY").replace("\\n", "\n"),
#     "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
#     "client_id": os.getenv("FIREBASE_CLIENT_ID"),
#     "auth_uri": "https://accounts.google.com/o/oauth2/auth",
#     "token_uri": "https://oauth2.googleapis.com/token",
#     "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
#     "client_x509_cert_url": os.getenv("FIREBASE_CLIENT_X509_CERT_URL"),
# })

# firebase_admin.initialize_app(cred)
# db = firestore.client()

# print("🔍 Analyzing Firebase chunks...\n")

# chunks_ref = db.collection('chunks')
# all_chunks = list(chunks_ref.stream())

# print(f"📊 Total chunks: {len(all_chunks)}\n")

# # Analyze chunk types
# text_chunks = []
# visual_chunks = []
# other_chunks = []

# for chunk_doc in all_chunks:
#     data = chunk_doc.to_dict()
#     chunk_type = data.get('type', 'unknown')
    
#     if chunk_type == 'text':
#         text_chunks.append(data)
#     elif chunk_type in ['visual', 'image']:
#         visual_chunks.append(data)
#     else:
#         other_chunks.append(data)

# print(f"📝 Text chunks: {len(text_chunks)}")
# print(f"🎨 Visual chunks: {len(visual_chunks)}")
# print(f"❓ Other chunks: {len(other_chunks)}\n")

# # Show sample visual chunks
# print("=" * 60)
# print("SAMPLE VISUAL CHUNKS:")
# print("=" * 60)

# for i, chunk in enumerate(visual_chunks[:3], 1):
#     print(f"\n--- Visual Chunk #{i} ---")
#     print(f"Document ID: {chunk.get('documentId')}")
#     print(f"Page: {chunk.get('metadata', {}).get('pageNumber')}")
#     print(f"Content length: {len(chunk.get('content', ''))}")
#     print(f"Has embedding: {'embedding' in chunk}")
#     if 'embedding' in chunk:
#         print(f"Embedding length: {len(chunk['embedding'])}")
#     print(f"Content preview: {chunk.get('content', '')[:200]}...")

# # Check if content is meaningful
# print("\n" + "=" * 60)
# print("CONTENT QUALITY CHECK:")
# print("=" * 60)

# useless_patterns = ['[Image:', 'img_', 'page_']
# problematic_chunks = 0

# for chunk in visual_chunks:
#     content = chunk.get('content', '')
#     if any(pattern in content for pattern in useless_patterns) and len(content) < 50:
#         problematic_chunks += 1

# if problematic_chunks > 0:
#     print(f"⚠️  Found {problematic_chunks} visual chunks with placeholder content!")
#     print("   These chunks won't answer queries properly.")
#     print("   You need to reprocess documents with vision analysis.")
# else:
#     print("✅ All visual chunks have meaningful content!")

# # Show sample text chunks for comparison
# print("\n" + "=" * 60)
# print("SAMPLE TEXT CHUNKS (for comparison):")
# print("=" * 60)

# for i, chunk in enumerate(text_chunks[:2], 1):
#     print(f"\n--- Text Chunk #{i} ---")
#     print(f"Document ID: {chunk.get('documentId')}")
#     print(f"Content length: {len(chunk.get('content', ''))}")
#     print(f"Content preview: {chunk.get('content', '')[:200]}...")

# print("\n✅ Analysis complete!")