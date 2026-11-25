package io.github.chlumael.twilightgames

import android.app.Activity
import android.content.Context
import android.os.CancellationSignal
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Google account picker via Credential Manager. The ID token is handed to the
 * web UI, which signs in to Firebase with it (the tracker account).
 * Needs the app's signing SHA-1 registered in the Firebase project.
 */
object GoogleSignIn {
    fun requestIdToken(activity: Activity, webClientId: String, done: (token: String?, error: String?) -> Unit) {
        val option = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(webClientId)
            .setAutoSelectEnabled(false)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        CredentialManager.create(activity).getCredentialAsync(
            activity, request, CancellationSignal(), activity.mainExecutor,
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val c = result.credential
                    if (c is CustomCredential && c.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                        runCatching { GoogleIdTokenCredential.createFrom(c.data).idToken }
                            .onSuccess { done(it, null) }
                            .onFailure { done(null, "구글 계정 정보를 읽지 못했습니다") }
                    } else {
                        done(null, "지원하지 않는 계정 형식입니다")
                    }
                }

                override fun onError(e: GetCredentialException) {
                    done(null, if (e is GetCredentialCancellationException) "로그인이 취소되었습니다" else (e.message ?: "로그인 실패"))
                }
            },
        )
    }

    /** Forget the chosen account so the picker shows again next time. */
    fun signOut(context: Context) {
        CredentialManager.create(context).clearCredentialStateAsync(
            ClearCredentialStateRequest(), null, context.mainExecutor,
            object : CredentialManagerCallback<Void?, ClearCredentialException> {
                override fun onResult(result: Void?) {}
                override fun onError(e: ClearCredentialException) {}
            },
        )
    }
}
