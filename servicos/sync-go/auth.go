package main

import (
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// Valida o token emitido pelo serviço de cadastros usando o segredo compartilhado.
func exigirToken(proximo http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		texto, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || texto == "" {
			responderErro(w, http.StatusUnauthorized, "Token não informado")
			return
		}
		token, err := jwt.Parse(texto, func(t *jwt.Token) (any, error) {
			return []byte(os.Getenv("JWT_SEGREDO")), nil
		}, jwt.WithValidMethods([]string{"HS256"}))
		if err != nil {
			responderErro(w, http.StatusUnauthorized, "Token inválido ou expirado")
			return
		}

		claims := token.Claims.(jwt.MapClaims)
		info := infoDaRequisicao(r)
		info.profissionalID, _ = claims["sub"].(string)
		info.perfil, _ = claims["perfil"].(string)
		info.token = texto
		proximo.ServeHTTP(w, r)
	})
}
