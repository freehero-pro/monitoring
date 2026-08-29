import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button, Card, ErrorText, Field, Hint, Input, Label, Title } from '../ui';

const Screen = styled.div`
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
`;

const Box = styled(Card)`
  width: 100%;
  max-width: 380px;
`;

const Sent = styled.p`
  margin: 12px 0 0;
  color: ${({ theme }) => theme.colors.muted};
`;

const LINK_ERRORS: Record<string, string> = {
  link_invalid: 'Ссылка недействительна. Запросите новую.',
  link_expired: 'Срок действия ссылки истёк. Запросите новую.',
  link_used: 'Ссылка уже использована. Запросите новую.',
  user_inactive: 'Доступ отключён. Обратитесь к администратору.',
};

export function LoginPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const linkError = params.get('error');

  const request = useMutation({
    mutationFn: (value: string) => api.post('/api/auth/magic-link', { email: value }),
  });

  return (
    <Screen>
      <Box>
        <Title>Вход в мониторинг</Title>
        <Hint>Введите почту — пришлём ссылку для входа. Регистрации нет: аккаунты заводит администратор.</Hint>

        <form
          style={{ marginTop: 18 }}
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate(email.trim());
          }}
        >
          <Field>
            <Label htmlFor="email">Почта</Label>
            <Input
              id="email"
              type="email"
              value={email}
              autoComplete="email"
              required
              placeholder="you@company.ru"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Button type="submit" disabled={request.isPending}>
            {request.isPending ? 'Отправляем…' : 'Получить ссылку'}
          </Button>
        </form>

        {request.isSuccess && (
          <Sent>
            Если такая почта заведена, письмо со ссылкой уже отправлено. Ссылка действует ограниченное время
            и сработает один раз.
          </Sent>
        )}
        {request.isError && <ErrorText>Не удалось отправить запрос. Попробуйте позже.</ErrorText>}
        {linkError && !request.isSuccess && (
          <ErrorText>{LINK_ERRORS[linkError] ?? 'Не удалось войти по ссылке.'}</ErrorText>
        )}
      </Box>
    </Screen>
  );
}
